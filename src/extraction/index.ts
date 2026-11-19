/**
 * extraction — what the channel is electrically.
 * Owns: quasi-TEM 2D cross-section extraction (field solve, per-unit-length RLGC),
 * per-route section lines and coupling (RouteFieldsSolver), and the matrix checks they need.
 * Imports: kernel, board.
 */
export type { Matrix } from './linalg'
export { validateMatrix, type MatrixCheck } from './checks'
export { sum, transpose, multiply, symmetrize } from './linalg'
