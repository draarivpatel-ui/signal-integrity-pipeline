/**
 * board — everything known about the physical board, read from Circuit JSON.
 * Owns: Circuit JSON admission (zod record schemas, subcircuit scope), stackup, port selection,
 * the declared board geometry and its routed sections.
 * Imports: kernel.
 */

/** @internal */
export {
  type ConnectivityMap,
  crossesDifferentialLegs,
  getSourcePortConnectivityMapFromCircuitJson,
  hasBuiltInPassiveModel,
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
  LaneModeling,
  PcbTrace,
  PortSelector,
  ReceiverTracePath,
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
/** @internal */
export type { PlanHeaderRow } from "./plan-header"
/** @internal */
export { getPinName, indexPlanPorts } from "./plan-view"
/** @internal */
export { renderPlanDrawing } from "./plan-visual"
/** @internal */
export {
  getTraceColor,
  type PlanOverlay,
  type PlanTrace,
  type PlanVisualEndpoint,
  type PlanVisualScene,
  planColors,
} from "./plan-visual-types"
export { findContactWire } from "./route-contacts"
export { findRouteReferences } from "./route-references"
export type {
  RouteReference,
  RouteSection,
  RouteWire,
  SectionGeometry,
} from "./route-section-types"
export { sectionRoutes, stepRouteSections } from "./route-sections"
export type { RouteSectionsInput } from "./route-sections-input"
export {
  type RouteSectionsOutput,
  RouteSectionsSolver,
} from "./route-sections-solver"
export { getRoutePoint } from "./route-wire"
export type {
  CircuitJson,
  SimulationExperiment,
  SimulationIbisModel,
} from "./schema"
export {
  cloneCircuitJson,
  recordSchema,
  validateCircuitRecords,
} from "./schema"
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
