/**
 * extraction — what the channel is electrically.
 * Owns: per-route section lines and coupling (RouteFieldsSolver), and their matrix checks.
 * Imports: kernel, board.
 */

export { type MatrixCheck, validateMatrix } from "./checks"
export type { Matrix } from "./linalg"
export { multiply, sum, symmetrize, transpose } from "./linalg"
