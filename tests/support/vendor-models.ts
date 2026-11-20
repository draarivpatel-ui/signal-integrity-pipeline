import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import lock from "../../examples/vendor-models.lock.json"

const modelDir = process.env.IBIS_MODEL_DIR

export const hasVendorModels = Boolean(modelDir)
export const vendorModels = lock.models
export type VendorModel = (typeof vendorModels)[keyof typeof vendorModels]

/** Load the original model bytes and verify the vendor lock before using them. */
export async function loadVendorModel(model: VendorModel): Promise<Uint8Array> {
  assert.ok(modelDir, "Set IBIS_MODEL_DIR to the directory of locked models")
  const bytes = await readFile(join(modelDir, model.file))
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    model.sha256,
    `${model.file}: locked SHA-256`,
  )
  return bytes
}
