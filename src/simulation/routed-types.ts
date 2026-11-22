import type { CircuitJson, LaneMapping } from "../board"
import type { IbisSources } from "../buffers"
import type { RunControls, SimulationModeling } from "./types"

/** Timing and mesh settings shared by the routed simulation stages. */
export interface RoutedCompileOptions {
  readonly riseSeconds: number
  readonly refinement: number
  readonly durationSeconds: number
  readonly stepSeconds: number
}
/** Board, receiver paths and physical trace cuts for routed IBIS binding. */
export interface RouteBindingsInput {
  readonly circuitJson: CircuitJson
  readonly mappings: readonly LaneMapping[]
  readonly routedTraceCuts: readonly LaneMapping[]
  readonly modeling: Readonly<SimulationModeling>
  readonly controls: Readonly<Record<string, RunControls>>
  readonly ibisSources: Readonly<IbisSources>
  readonly options: RoutedCompileOptions
  readonly artifactPrefix: string
}
