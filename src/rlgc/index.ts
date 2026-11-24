/** Calculates per-unit-length electrical matrices from 2D cross-sections. */
export {
  type CrossSection,
  type CrossSectionConductor,
  type CrossSectionDielectricLayer,
  type CrossSectionOptions,
  type CrossSectionPlane,
  calculateCapacitanceMatrix,
  calculateRlgc,
  type RlgcMatrices,
} from "./cross-section"
export { calculateMatrixInverse } from "./cross-section-matrix"
