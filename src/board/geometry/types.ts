// Port selectors, lane mappings and routed copper shapes shared by board admission and the routed stages.
import type {
  PcbTraceRoutePointVia,
  PcbTraceRoutePointWire,
  SourceTrace,
} from "circuit-json"
import type { SourcePortId } from "../ids"

export type {
  PcbTrace,
  PcbTraceRoutePoint as RoutePoint,
  SourcePort,
} from "circuit-json"

export type PortSelector =
  | {
      sourcePortId: SourcePortId
      component?: never
      port?: never
    }
  | {
      sourcePortId?: never
      component: string
      port: string
    }
export interface LaneModeling {
  port: string
  from: PortSelector
  to: PortSelector
  sourceTraceId?: SourceTrace["source_trace_id"]
}
/** A trace route point on a wire or via. */
export type RoutedPoint = PcbTraceRoutePointWire | PcbTraceRoutePointVia

/** One driver-to-receiver physical signal; `sourceTraceIds` lists every trace cut out of ideal connectivity. */
export interface LaneMapping {
  port: string
  sourceTraceId: SourceTrace["source_trace_id"]
  from: SourcePortId
  to: SourcePortId
  sourceTraceIds?: SourceTrace["source_trace_id"][]
}

/** Copper outlines in mm. */
export type CopperPoint = [number, number]
/** The copper outline ring followed by any cutout rings. */
export type CopperPolygon = CopperPoint[][]
