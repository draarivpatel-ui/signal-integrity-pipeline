import type {
  CopperScope,
  LaneModeling,
  SourcePortId,
  SourceTraceId,
} from "../board"
import type { SimulationModeling } from "../simulation"
/** A selected two-terminal trace with physical source ports at both ends. */
export interface RoutedLane extends LaneModeling {
  from: { sourcePortId: SourcePortId }
  to: { sourcePortId: SourcePortId }
  sourceTraceId: SourceTraceId
}

/** Private channel simulation planning settings derived from the board and selected IBIS buffers. */
export type NumericalSettings = SimulationModeling & {
  lanes: RoutedLane[]
  channelReference: { sourcePortId: SourcePortId }
  copperScope: CopperScope
}
