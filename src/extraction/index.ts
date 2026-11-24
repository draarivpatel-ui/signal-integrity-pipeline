/**
 * Routed fields, coupling, causal loss and matrix checks for the channel model.
 * Imports: kernel, board.
 */

export {
  causalLossPoles,
  causalLossResponse,
  crossoverPoles,
  type LossPole,
  skinCrossover,
} from "./causal-loss"
export { type MatrixCheck, validateMatrix } from "./checks"
export type { Matrix } from "./linalg"
export { multiply, sum, symmetrize, transpose } from "./linalg"
export { type RouteFieldsInput, RouteFieldsSolver } from "./route-fields-solver"
export {
  closestRoutePoints,
  type ExtractedRouteSlice,
  type ExtractedRoutes,
  type RouteCoefficients,
  type RouteMaterials,
  referenceSeries,
  rlgcCrossSection,
  routeCrossSection,
} from "./route-lines"
