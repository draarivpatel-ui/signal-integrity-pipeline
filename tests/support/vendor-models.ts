import { accessSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

/** Whether a local vendor asset is present; used by Bun's test.skipIf at registration. */
export function vendorAvailable(file: string): boolean {
  if (!process.env.IBIS_MODEL_DIR) return false
  try {
    accessSync(join(process.env.IBIS_MODEL_DIR, file))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

/** Read original local vendor bytes; enabled tests never substitute synthetic assets. */
export async function vendorText(file: string): Promise<string> {
  if (!process.env.IBIS_MODEL_DIR)
    throw new Error("Set IBIS_MODEL_DIR to the original local vendor models")
  return readFile(join(process.env.IBIS_MODEL_DIR, file), "utf8")
}
