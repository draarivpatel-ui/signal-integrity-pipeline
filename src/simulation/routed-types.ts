import type { CircuitJson, CopperScope, LaneMapping } from "../board"
import type { IbisSources } from "../buffers"
import type { RunControls, SimulationModeling } from "./types"

export interface RoutedCompileOptions {
  riseSeconds: number
  refinement: number
  durationSeconds: number
  stepSeconds: number
  panels?: number
  currentToleranceA?: number
  cellsPerRise?: number
}
export interface RouteBindingsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  mappings: LaneMapping[]
  modeling: SimulationModeling
  controls: Record<string, RunControls>
  ibisSources: IbisSources
  options: RoutedCompileOptions
  artifactPrefix: string
}
