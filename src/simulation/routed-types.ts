import type {
  CircuitJson,
  CopperScope,
  LaneMapping,
  SectionGeometry,
  SourcePortId,
} from "../board"
import type { CompiledBuffer, IbisSources } from "../buffers"
import type { ExtractedRoutes, RouteMaterials } from "../extraction"
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
/** Admitted binding inputs and the copper scope resolved by route sectioning. */
export interface ScopedRouteBindingsInput extends RouteBindingsInput {
  readonly copperScope: CopperScope
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
  mappings: readonly LaneMapping[]
  plan: SimulationPlan
  nodeMap: CircuitNodes["mapping"]
  groundSourcePortId: SourcePortId
  electricalLines: string[]
  models: RouteBuffer[]
}
/** Scoped geometry, field results and electrical bindings for a routed deck. */
export interface RouteNetworkInput {
  simulationPcbTransientChannelSimulationId: string
  name: string
  geometry: SectionGeometry
  extracted: ExtractedRoutes
  bindings: RoutedBindings
  materials: RouteMaterials
  options: RoutedCompileOptions
  warnings: readonly string[]
  artifactPrefix: string
}
/** Executable SPICE input and evidence for one routed transient. */
export interface RoutedDeck {
  simulationPcbTransientChannelSimulationId: string
  name: string
  deck: string
  requestSha256: string
  probes: VoltageProbePlan[]
  durationSeconds: number
  stepSeconds: number
  evidence: Record<string, unknown>
}
/** A completed live transient; failures never expose a partial capture. */
export interface RoutedCapture {
  kind: "completed"
  qualification: "candidate-unqualified"
  timestampsSeconds: number[]
  probes: RoutedProbeCapture[]
}

/** Recorded voltages for a physical source port at the capture's adaptive sample times. */
interface RoutedProbeCapture {
  name: string
  sourcePortId: SourcePortId
  voltageLevels: number[]
}
