import type {
  CircuitJsonSnapshot,
  CopperScope,
  LaneMapping,
  SectionGeometry,
  SourcePortId,
  SourceTraceId,
} from "../board"
import type { CompiledBuffer, IbisSources } from "../buffers"
import type { ExtractedRoutes, RouteMaterials } from "../extraction"
import type { Snapshot } from "../kernel"
import type {
  CircuitNodes,
  RunControls,
  SimulationModeling,
  SimulationPlan,
  VoltageProbePlan,
} from "./types"

/** Timing and mesh settings shared by the routed simulation stages. */
export interface RoutedCompileOptions {
  readonly riseSeconds: number
  readonly refinement: number
  readonly durationSeconds: number
  readonly stepSeconds: number
  panels?: number
  currentToleranceA?: number
  cellsPerRise?: number
  readonly materials?: RouteMaterials
}
/** One physical conductor removed from ideal connectivity for routed extraction. */
export interface RoutedTraceCut {
  readonly sourceTraceId: SourceTraceId
  readonly fromSourcePortId: SourcePortId
  readonly toSourcePortId: SourcePortId
}

/** Distinct contacts connected by an explicit ideal segment between routed cuts. */
export interface IdealRoutedJunction {
  readonly fromSourcePortId: SourcePortId
  readonly toSourcePortId: SourcePortId
}

/** Board, receiver paths and physical trace cuts for routed IBIS binding. */
export interface RouteBindingsInput {
  readonly circuitJson: CircuitJsonSnapshot
  readonly mappings: readonly LaneMapping[]
  readonly routedTraceCuts: readonly RoutedTraceCut[]
  readonly idealRoutedJunctions: readonly IdealRoutedJunction[]
  readonly modeling: Snapshot<SimulationModeling>
  readonly controls: Snapshot<Record<string, RunControls>>
  readonly ibisSources: Readonly<IbisSources>
  readonly options: RoutedCompileOptions
  readonly artifactPrefix: string
}
/** Admitted binding inputs and the copper scope resolved by route sectioning. */
export interface ScopedRouteBindingsInput extends RouteBindingsInput {
  readonly copperScope: Snapshot<CopperScope>
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
export type RoutedBindings = Snapshot<{
  circuitJson: CircuitJsonSnapshot
  scope: CopperScope
  mappings: readonly LaneMapping[]
  plan: SimulationPlan
  nodeMap: CircuitNodes["mapping"]
  groundSourcePortId: SourcePortId
  electricalLines: string[]
  models: RouteBuffer[]
}>
/** Scoped geometry, field results and electrical bindings for a routed deck. */
export interface RouteNetworkInput {
  simulationPcbTransientChannelSimulationId: string
  name: string
  geometry: Snapshot<SectionGeometry>
  extracted: ExtractedRoutes
  bindings: RoutedBindings
  materials: RouteMaterials
  options: RoutedCompileOptions
  warnings: readonly string[]
  artifactPrefix: string
}
/** Executable SPICE input and evidence for one routed transient. */
export type RoutedDeck = Snapshot<{
  simulationPcbTransientChannelSimulationId: string
  name: string
  deck: string
  requestSha256: string
  probes: VoltageProbePlan[]
  durationSeconds: number
  stepSeconds: number
  evidence: Record<string, unknown>
}>
