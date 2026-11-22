import type {
  CircuitJson,
  CopperScope,
  LaneMapping,
  SourcePortId,
} from "../board"
import type { CompiledBuffer, IbisSources } from "../buffers"
import type { RouteMaterials } from "../extraction"
import type {
  CircuitNodes,
  RunControls,
  SimulationModeling,
  SimulationPlan,
} from "./types"

/** Timing and mesh settings shared by the routed simulation stages. */
export interface RoutedCompileOptions {
  readonly riseSeconds: number
  readonly refinement: number
  readonly durationSeconds: number
  readonly stepSeconds: number
  readonly materials?: RouteMaterials
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
/** Compiled IBIS buffer data needed to wire a routed deck. */
export type RouteBuffer = Pick<
  CompiledBuffer,
  | "name"
  | "source"
  | "spicePinMapping"
  | "metadata"
  | "warnings"
  | "sourceEvidence"
>
/** Immutable circuit nodes, compiled buffers and inputs for the route network. */
export interface RoutedBindings {
  circuitJson: CircuitJson
  scope: CopperScope
  mappings: LaneMapping[]
  plan: SimulationPlan
  nodeMap: CircuitNodes["mapping"]
  groundSourcePortId: SourcePortId
  electricalLines: string[]
  models: RouteBuffer[]
}
