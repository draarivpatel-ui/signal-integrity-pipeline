// Copied from tests/node.test.ts, repointed at src/adapters. Assertions unchanged.
import { afterEach, test } from 'bun:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createNativeSolver,loadIbisSources} from '../../src/adapters'

const temporaryRoots: string[] = []
afterEach(async () => {
  for (const path of temporaryRoots.splice(0)) await rm(path, { recursive: true, force: true })
})

/** Makes a scratch directory that is deleted when the test finishes. */
const temporary=async(): Promise<string>=>{
  const path=await mkdtemp(join(tmpdir(),'pcb-node-test-'))
  temporaryRoots.push(path)
  return path
}
test('native adapter isolates requests, captures files and logs, and cleans up success and failure', async () => {
  const root=await temporary()
  const entry=join(root,'solver.mjs')
  const location=join(root,'location.txt')
  const toolSource = `import { readFileSync, writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(location)}, process.cwd())
process.stdout.write('ran')
process.stderr.write('notice')
if (process.argv.includes('signal')) process.kill(process.pid, 'SIGTERM')
if (process.argv.includes('fail')) process.exit(7)
if (process.argv.includes('timeout')) {
  setTimeout(() => {}, 15000)
} else {
  writeFileSync('output.dat', readFileSync('nested/input.dat', 'utf8'))
}
`
  await writeFile(entry, toolSource)
  const solver=createNativeSolver({tools:{ngspice:process.execPath},timeoutMs:5000})
  const request = {
    solver: 'ngspice' as const,
    files: { 'nested/input.dat': 'exact input\r\n' },
    args: [entry],
    outputFiles: ['output.dat'],
  }
  const output=await solver(request)
  assert.deepEqual(output.stdout,'ran')
  assert.deepEqual(output.stderr,'notice')
  assert.equal(output.files['output.dat'],'exact input\r\n')
  const cwd=await readFile(location,'utf8')
  await assert.rejects(stat(cwd),{code:'ENOENT'})
  await assert.rejects(solver({...request,args:[entry,'fail']}),/native_solver.*Command failed/)
  await assert.rejects(stat(await readFile(location,'utf8')),{code:'ENOENT'})
  await assert.rejects(solver({...request,args:[entry,'signal']}),/native_solver/)
  await assert.rejects(solver({...request,args:[entry,'timeout']}),error=>{
    assert.equal((error as {code:string}).code,'native_timeout')
    assert.match((error as Error).message,/ngspice.*5000 ms/)
    assert.match((error as Error).message,/ran[\s\S]*notice/)
    return true
  })
  await assert.rejects(stat(await readFile(location,'utf8')),{code:'ENOENT'})
  await assert.rejects(solver({...request,files:{'../escape':'bad'}}),/file_path/)
  assert.throws(()=>createNativeSolver({timeoutMs:0}),/native_timeout/)
}, 15_000)
