/**
 * extraction — what the channel is electrically.
 * Owns: routed fields, coupling, matrix checks and causal loss.
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
