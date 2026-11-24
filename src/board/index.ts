/**
 * board — everything known about the physical board, read from Circuit JSON.
 * Owns: Circuit JSON admission (zod record schemas, subcircuit scope), stackup, port selection,
 * the declared board geometry and its routed sections.
 * Imports: kernel.
 */

export {
  type ConnectivityMap,
  crossesDifferentialLegs,
  getSourcePortConnectivityMapFromCircuitJson,
  type PassiveBridge,
  passiveBridges,
  sourceConnections,
  sourceNetMembers,
  sourcePinTies,
} from "./connectivity"
export { polygonContains } from "./geometry/polygon"
export { resolveRouteVias, selectPort } from "./geometry/ports"
export { type CopperScope, channelCopperScope } from "./geometry/scope"
export type {
  CopperPoint,
  CopperPolygon,
  LaneMapping,
  LaneModeling,
  PcbTrace,
  PortSelector,
  RoutedPoint,
  RoutePoint,
  SourcePort,
} from "./geometry/types"
export type {
  SignalEndpointPortIds,
  SimulationPcbTransientChannelSimulationId,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "./ids"
export type { PlanHeaderRow } from "./plan-header"
export { pinName, planPorts } from "./plan-view"
export { planDrawing } from "./plan-visual"
export {
  type PlanVisualCut,
  type PlanVisualEndpoint,
  type PlanVisualLink,
  type PlanVisualScene,
  planColors,
  planCutColor,
} from "./plan-visual-types"
export type { RouteSectionsInput } from "./route-sections-solver"
export type {
  CircuitJson,
  SimulationExperiment,
  SimulationIbisModel,
} from "./schema"
export { recordSchema, validateCircuitRecords } from "./schema"
export {
  type DriverPattern,
  endpointPorts,
  isQuiet,
  type SignalEndpoint,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
} from "./signals"
export {
  type BoardStackup,
  type CopperLayer,
  type DielectricLayer,
  defaultCopperConductivitySm,
  stackupFromCircuitJson,
} from "./stackup"
export { type SubcircuitTree, subcircuitTree } from "./subcircuit"
