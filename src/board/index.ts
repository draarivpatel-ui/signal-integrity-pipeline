/**
 * board — everything known about the physical board, read from Circuit JSON.
 * Owns: Circuit JSON admission (zod record schemas, subcircuit scope), stackup, port selection,
 * the declared board geometry and its routed sections.
 * Imports: kernel.
 */
export type { CircuitJson, SimulationExperiment, SimulationIbisModel } from './schema'
export { recordSchema, validateCircuitRecords } from './schema'
export {
  type BoardStackup,
  type CopperLayer,
  type DielectricLayer,
  stackupFromCircuitJson,
  defaultCopperConductivitySm,
} from './stackup'
export { subcircuitTree, type SubcircuitTree } from './subcircuit'
export { getSourcePortConnectivityMapFromCircuitJson, passiveConnections, sourceConnections, sourceNetMembers, type ConnectivityMap } from './connectivity'
export type {
  PortSelector,
  LaneModeling,
  SourcePort,
  PcbTrace,
  RoutePoint,
  RoutedPoint,
  LaneMapping,
  CopperPoint,
  CopperPolygon,
} from './geometry/types'
export { selectPort, resolveRouteVias } from './geometry/ports'
export { polygonContains } from './geometry/polygon'
