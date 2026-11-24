import { defaultCopperConductivitySm } from "../board"
import { sectionField } from "./cross-section-field"
import { sectionPassive } from "./cross-section-matrix"
import { sectionRegions } from "./cross-section-mesh"
import type {
  CrossSection,
  CrossSectionOptions,
  CrossSectionResult,
} from "./cross-section-types"
import { validateSection } from "./cross-section-validation"
import { calculateSkinCoefficients, inductance } from "./cross-section-wheeler"
import { fail } from "./diagnostics"
import type { Matrix } from "./linalg"

export type {
  CrossSection,
  CrossSectionOptions,
  CrossSectionResult,
  SectionConductor,
  SectionDielectric,
  SectionPlane,
} from "./cross-section-types"

/** Default and minimum counts of panels per conductor edge. */
const DEFAULT_PANELS_PER_EDGE = 12
/** Resolve conductor corners with a minimum of six panels per edge. */
const MIN_PANELS_PER_EDGE = 6

/** Default and minimum horizontal padding measured in cross-section spans. */
const DEFAULT_INTERFACE_EXTENT = 24
/** Keep dielectric interface truncation several spans from the conductors. */
const MIN_INTERFACE_EXTENT = 4

/** Recede conductor walls by a small fraction of their clearance for Wheeler loss. */
const DEFAULT_RECESSION_FRACTION = 0.01
/** Keep the recession step small relative to nearby features. */
const MAX_RECESSION_FRACTION = 0.1

/** Cross-sectional area is in square millimeters and DC resistance is computed in SI units. */
const SQUARE_MILLIMETERS_PER_SQUARE_METER = 1e6

/** Check panel resolution and interface padding shared by the capacitance and full field solvers. */
function validMesh({
  count,
  extent,
}: {
  count: number
  extent: number
}): boolean {
  return (
    Number.isInteger(count) &&
    count >= MIN_PANELS_PER_EDGE &&
    Number.isFinite(extent) &&
    extent >= MIN_INTERFACE_EXTENT
  )
}

/** Electrostatic-only extraction uses the identical dielectric solve without unused magnetic/loss solves. */
export function solveSectionCapacitance({
  section,
  options = {},
}: {
  section: CrossSection
  options?: Pick<CrossSectionOptions, "panelsPerEdge" | "interfaceExtent">
}): Matrix {
  validateSection(section)
  const count = options.panelsPerEdge ?? DEFAULT_PANELS_PER_EDGE
  const extent = options.interfaceExtent ?? DEFAULT_INTERFACE_EXTENT
  if (!validMesh({ count, extent }))
    fail(
      "cross_section_options",
      "Use >=6 panels per edge and interface extent >=4",
    )
  const C = section.conductors.map(() => section.conductors.map(() => 0))
  for (const { region, indices } of sectionRegions(section)) {
    const field = sectionField({
      region,
      count,
      extent,
      includeDielectricLoss: false,
    })
    for (const [i, ii] of indices.entries()) {
      for (const [j, jj] of indices.entries()) C[ii][jj] = field.C[i][j]
    }
  }
  sectionPassive({ matrix: C, strict: true })
  return C
}

/** Zero matrix in input conductor order. */
function zeroMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => Array(size).fill(0))
}

/** Cheap quasi-TEM extraction with infinite solid references, layered dielectric/mask boundaries
 * and Wheeler incremental-inductance conductor loss. No native processes or pipeline integration.
 * Default work is fixed; convergence is measured by independently changing the two mesh options.
 */
export function solveCrossSection({
  section,
  options = {},
}: {
  section: CrossSection
  options?: CrossSectionOptions
}): CrossSectionResult {
  validateSection(section)
  const count = options.panelsPerEdge ?? DEFAULT_PANELS_PER_EDGE
  const extent = options.interfaceExtent ?? DEFAULT_INTERFACE_EXTENT
  const fraction = options.recessionFraction ?? DEFAULT_RECESSION_FRACTION
  const validRecession =
    Number.isFinite(fraction) &&
    fraction > 0 &&
    fraction <= MAX_RECESSION_FRACTION
  if (!validMesh({ count, extent }) || !validRecession) {
    fail(
      "cross_section_options",
      "Use >=6 panels per edge, interface extent >=4 and recession fraction in (0, .1]",
    )
  }
  const size = section.conductors.length
  const C = zeroMatrix(size)
  const C0 = zeroMatrix(size)
  const L = zeroMatrix(size)
  const dielectricLoss = zeroMatrix(size)
  const skinResistance = zeroMatrix(size)
  const stripSkinResistance = zeroMatrix(size)
  const dcResistance = zeroMatrix(size)
  let panels = 0
  let residual = 0
  let recessionMm = Infinity
  for (const { region, indices } of sectionRegions(section)) {
    const mesh = { region, count, extent }
    const vacuum = sectionField({ ...mesh, vacuum: true })
    const field = sectionField(mesh)
    const external = inductance(vacuum.C)
    const skin = calculateSkinCoefficients({ mesh, fraction })
    for (const [i, ii] of indices.entries()) {
      for (const [j, jj] of indices.entries()) {
        C[ii][jj] = field.C[i][j]
        C0[ii][jj] = vacuum.C[i][j]
        L[ii][jj] = external[i][j]
        dielectricLoss[ii][jj] = field.loss[i][j]
        skinResistance[ii][jj] = skin.skinResistance[i][j]
        stripSkinResistance[ii][jj] = skin.stripSkinResistance[i][j]
      }
    }
    panels += field.panels
    residual = Math.max(residual, field.residual, vacuum.residual)
    recessionMm = Math.min(recessionMm, skin.recessionMm)
  }
  for (const matrix of [C, C0, L]) sectionPassive({ matrix, strict: true })
  for (const matrix of [dielectricLoss, skinResistance, stripSkinResistance])
    sectionPassive({ matrix })
  for (const [i, c] of section.conductors.entries()) {
    const conductivity = c.conductivitySm ?? defaultCopperConductivitySm
    dcResistance[i][i] =
      SQUARE_MILLIMETERS_PER_SQUARE_METER /
      (conductivity * c.widthMm * c.thicknessMm)
  }
  return {
    conductorIds: section.conductors.map((c) => c.id),
    C,
    C0,
    L,
    dielectricLoss,
    dcResistance,
    skinResistance,
    stripSkinResistance,
    diagnostics: { panels, reciprocityResidual: residual, recessionMm },
  }
}
