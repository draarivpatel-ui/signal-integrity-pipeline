/**
 * Matrix checks and linear algebra for the channel model.
 * Imports: kernel, board.
 */

export { type MatrixCheck, validateMatrix } from "./checks"
export type { Matrix } from "./linalg"
export { multiply, sum, symmetrize, transpose } from "./linalg"
export { type RouteFieldsInput, RouteFieldsSolver } from "./route-fields-solver"
export type { ExtractedRoutes } from "./route-lines"
export { buildCrossSection } from "./section-cross-section"
export type { DielectricMaterials } from "./section-materials"
