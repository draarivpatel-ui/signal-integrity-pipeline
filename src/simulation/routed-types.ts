import type {
  CircuitJsonSnapshot,
  LaneMapping,
  SourcePortId,
  SourceTraceId,
} from "../board"
import type { IbisSources } from "../buffers"
import type { Snapshot } from "../kernel"
import type { RunControls, SimulationModeling } from "./types"

/** Timing and mesh settings shared by the routed simulation stages. */
export interface RoutedCompileOptions {
  readonly riseSeconds: number
  readonly refinement: number
  readonly durationSeconds: number
  readonly stepSeconds: number
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
