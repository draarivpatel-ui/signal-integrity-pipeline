import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RunSolver, Solver } from '../solver'
import { fail } from './diagnostics'
import { contained, relativeFile } from './paths'

export interface NativeSolverOptions {
  tools?: Partial<Record<Solver, string>>
  timeoutMs?: number
}
const exec = promisify(execFile)

/** Give native solvers up to fifteen minutes to complete the requested run. */
const DEFAULT_TIMEOUT_MS = 900000

/** Cap each captured output stream at 64 MiB. */
const OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024

/**
 * Executes only requests passed by the caller; never installs or downloads tools.
 * Lifecycle: validate -> mkdtemp -> write -> spawn -> collect, with rm in `finally`.
 * Cleanup runs on every path (finally). Collects only requested outputFiles, each contained in the workdir.
 */
export function createNativeSolver({
  tools = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: NativeSolverOptions = {}): RunSolver {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail('native_timeout', 'timeoutMs must be a positive integer')
  }
  return async request => {
    if (request.solver !== 'ngspice') fail('native_solver', 'Unknown solver')
    for (const path of [...Object.keys(request.files), ...request.outputFiles]) relativeFile(path)
    const directory = await mkdtemp(join(tmpdir(), 'pcb-spice-'))
    try {
      for (const [path, body] of Object.entries(request.files)) {
        const target = join(directory, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, body)
      }
      let run: {
        stdout: string
        stderr: string
      }
      try {
        run = await exec(tools.ngspice ?? 'ngspice', request.args,
          {
            cwd: directory,
            timeout: timeoutMs,
            maxBuffer: OUTPUT_BUFFER_BYTES,
            env: { ...process.env, OMP_NUM_THREADS: '1' },
          })
      } catch (error) {
        const detail = error as Error & {
          code?: string | number | null
          killed?: boolean
          signal?: string
          stdout?: string
          stderr?: string
        }
        // execFile's timeout kills with SIGTERM and no exit code. External
        // signals are not marked killed; maxBuffer errors have a string code.
        const timedOut = detail.killed && detail.signal === 'SIGTERM' && detail.code === null
        const output = `${detail.stdout ?? ''}\n${detail.stderr ?? ''}`
        if (timedOut) {
          const timeout = `exceeded ${timeoutMs} ms process timeout; ${detail.message}`
          fail('native_timeout', `${request.solver}: ${timeout}\n${output}`)
        }
        fail('native_solver', `${request.solver}: ${detail.message}\n${output}`)
      }
      const files: Record<string, string> = Object.create(null)
      const root = await realpath(directory)
      for (const path of request.outputFiles) {
        try {
          files[path] = await readFile(contained({ root, path: await realpath(join(directory, path)) }), 'utf8')
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          // The pipeline validates required outputs and solver diagnostics.
        }
      }
      return { ...run, files }
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}
