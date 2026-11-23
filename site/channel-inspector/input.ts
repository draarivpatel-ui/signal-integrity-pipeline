import {
  type CircuitJson,
  type SimulationPcbTransientChannelSimulation,
  validateCircuitRecords,
} from "../../src/board"
import type { Snapshot } from "../../src/kernel"
import {
  listChannelSimulations,
  validatedScopeDistanceMm,
} from "../../src/pipeline/signals"
import { type InspectorBoard, inspectorBoard } from "./geometry"
import { isInlineIbis } from "./ibis-panel"

export type ChannelSimulation =
  Snapshot<SimulationPcbTransientChannelSimulation>

/** A loaded board and the channel simulations available for inspection. */
export interface InspectorInput {
  name: string
  circuit: CircuitJson
  simulations: ChannelSimulation[]
  board: InspectorBoard
  distanceMm: number
}

/** Validate the standard records while retaining IBIS text embedded as a data URL. */
function parseCircuit(text: string): CircuitJson {
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value))
    throw new Error("Expected a Circuit JSON record array.")
  validateCircuitRecords(
    value.map((record) => {
      const asset = record?.ibis_model_asset
      if (
        record?.type !== "simulation_ibis_model" ||
        typeof asset?.url !== "string" ||
        !isInlineIbis(asset.url)
      )
        return record
      return {
        ...record,
        ibis_model_asset: { ...asset, url: asset.project_relative_path },
      }
    }),
  )
  return value as CircuitJson
}

/** Read a local Circuit JSON file or the on-demand TSX fixture. */
export async function loadInput(file?: File): Promise<InspectorInput> {
  let circuit: CircuitJson
  let name: string
  let distanceMm = validatedScopeDistanceMm()
  if (file) {
    if (!file.name.toLowerCase().endsWith(".json"))
      throw new Error("Choose a .json Circuit JSON file.")
    circuit = parseCircuit(await file.text())
    name = file.name
  } else {
    const sample = await import("./sample")
    circuit = await sample.loadInspectorSample()
    name = "Parallel bus sample"
    distanceMm = sample.sampleScopeDistanceMm
  }
  const simulations = listChannelSimulations(circuit)
  if (simulations.length === 0)
    throw new Error("Circuit JSON has no transient channel simulations.")
  return {
    name,
    circuit,
    simulations,
    board: inspectorBoard(circuit),
    distanceMm,
  }
}
