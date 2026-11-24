import type { WireSection } from "../board"
import type { Snapshot } from "../kernel"
import type { RlgcMatrices } from "../rlgc"
import type { PairCoupling } from "./route-coupling"
import type {
  DielectricMaterials,
  MaskThicknessSource,
} from "./section-materials"

/** Serialized relative conductor geometry, reference planes, and dielectric layers. */
export type CrossSectionKey = string

/** Per-unit-length matrices for one unique cross-section. */
export interface CrossSectionSolution {
  crossSectionKey: CrossSectionKey
  rlgcMatrices: Snapshot<RlgcMatrices>
}

/** A solved group tied to the source wire section screened for coupling. */
export interface SolvedWireSection
  extends Snapshot<WireSection>,
    CrossSectionSolution {
  wireSectionIndex: number
}

/** Solved wire sections and the material and coupling decisions used to construct them. */
export type ExtractedRoutes = Snapshot<{
  solvedWireSections: SolvedWireSection[]
  crossSectionSolutions: CrossSectionSolution[]
  pairCouplings: PairCoupling[]
  materials: DielectricMaterials
  maskThicknessSource: MaskThicknessSource
  panelsPerEdge: number
  warnings: string[]
}>
