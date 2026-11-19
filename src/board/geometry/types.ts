// Port selectors, lane mappings and routed copper shapes shared by board admission and the routed stages.
import type { PcbTraceRoutePointVia, PcbTraceRoutePointWire } from 'circuit-json'

export type { PcbTrace, PcbTraceRoutePoint as RoutePoint, SourcePort } from 'circuit-json'

export type PortSelector = {
  sourcePortId: string
  component?: never
  port?: never
} | {
  sourcePortId?: never
  component: string
  port: string
}
export interface LaneModeling {
  port: string
  from: PortSelector
  to: PortSelector
  sourceTraceId?: string
}
/** A trace route point on a wire or via. */
export type RoutedPoint = PcbTraceRoutePointWire | PcbTraceRoutePointVia

/** One driver-to-receiver physical signal; `sourceTraceIds` lists every trace cut out of ideal connectivity. */
export interface LaneMapping {
  port: string
  sourceTraceId: string
  from: string
  to: string
  sourceTraceIds?: string[]
}

/** Copper outlines in mm. */
export type CopperPoint = [number, number]
export type CopperPolygon = CopperPoint[][]
