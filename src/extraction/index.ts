/**
 * extraction — what the channel is electrically.
 * Owns: per-route section lines and coupling (RouteFieldsSolver), and their matrix checks.
 * Imports: kernel, board.
 */

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
