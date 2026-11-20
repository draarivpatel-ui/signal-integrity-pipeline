import { createHash } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { join, resolve } from "node:path"
import lock from "../examples/vendor-models.lock.json"

type VendorModel = (typeof lock.models)[keyof typeof lock.models]

/** Allow two minutes for each vendor to serve its archive. */
const DOWNLOAD_TIMEOUT_MS = 120_000

/** Stop before using any archive or model that differs from the lock. */
function verifyHash({
  bytes,
  expected,
  label,
}: {
  bytes: Uint8Array
  expected: string
  label: string
}): void {
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== expected) {
    throw new Error(
      `${label}: SHA-256 mismatch (expected ${expected}, got ${actual})`,
    )
  }
}

/** Verify a cached model or install a newly verified copy from its archive. */
async function fetchVendorModel({
  model,
  directory,
  temporaryDirectory,
}: {
  model: VendorModel
  directory: string
  temporaryDirectory: string
}): Promise<void> {
  const target = join(directory, model.file)
  const cached = await readFile(target).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    },
  )
  if (cached) {
    verifyHash({ bytes: cached, expected: model.sha256, label: target })
    console.log(`Verified cached ${model.file}`)
    return
  }

  const response = await fetch(model.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `${model.url}: download failed with HTTP ${response.status}`,
    )
  }
  const archiveBytes = new Uint8Array(await response.arrayBuffer())
  verifyHash({
    bytes: archiveBytes,
    expected: model.archiveSha256,
    label: model.url,
  })

  const archive = join(temporaryDirectory, "archive.zip")
  await writeFile(archive, archiveBytes)
  const extracted = Bun.spawnSync(["unzip", "-p", archive, model.archivePath])
  if (!extracted.success) {
    throw new Error(
      `${model.url}: cannot extract ${model.archivePath}: ${extracted.stderr.toString().trim()}`,
    )
  }
  verifyHash({ bytes: extracted.stdout, expected: model.sha256, label: target })
  const pending = join(temporaryDirectory, model.file)
  await writeFile(pending, extracted.stdout)
  await rename(pending, target)
  console.log(`Fetched and verified ${model.file}`)
}

const directory = resolve(process.env.IBIS_MODEL_DIR || "models")
await mkdir(directory, { recursive: true })
const temporaryDirectory = await mkdtemp(join(directory, ".fetch-"))
try {
  for (const model of Object.values(lock.models)) {
    await fetchVendorModel({ model, directory, temporaryDirectory })
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
