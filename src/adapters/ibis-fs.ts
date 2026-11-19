import { readFile, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import type { CircuitJson } from "../board"
import type { IbisSources } from "../buffers"
import { contained, relativeFile } from "./paths"

/** Load declared local files only. Asset URLs do not trigger downloads. Realpath-contained in baseDir. */
export async function loadIbisSources({
  circuitJson,
  baseDir,
}: {
  circuitJson: CircuitJson
  baseDir: string
}): Promise<IbisSources> {
  const root = await realpath(baseDir)
  const sources: IbisSources = Object.create(null)
  for (const record of circuitJson) {
    if (record.type !== "simulation_ibis_model") continue
    const path = relativeFile(record.ibis_model_asset.project_relative_path)
    if (Object.hasOwn(sources, path)) continue
    const target = await realpath(resolve(root, path))
    sources[path] = await readFile(contained({ root, path: target }))
  }
  return sources
}
