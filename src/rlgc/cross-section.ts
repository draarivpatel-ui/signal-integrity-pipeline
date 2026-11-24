import { defaultCopperConductivitySm } from "../board"
import type { Matrix } from "../kernel"
import { calculateRegionField } from "./cross-section-field"
import { assertMatrixPassive } from "./cross-section-matrix"
import { partitionCrossSection } from "./cross-section-mesh"
import type {
  CrossSection,
  CrossSectionOptions,
  RlgcMatrices,
} from "./cross-section-types"
import { validateCrossSection } from "./cross-section-validation"
import {
  calculateExternalInductance,
  calculateSkinCoefficients,
} from "./cross-section-wheeler"
import { fail } from "./diagnostics"

export type {
  CrossSection,
  CrossSectionConductor,
  CrossSectionDielectricLayer,
  CrossSectionOptions,
  CrossSectionPlane,
  RlgcMatrices,
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

/** Check panel resolution and interface padding shared by the capacitance and full RLGC calculation. */
function hasValidMeshOptions({
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

/** Calculate electrostatic capacitance without inductance or loss coefficients. */
export function calculateCapacitanceMatrix({
  crossSection,
  options = {},
}: {
  crossSection: CrossSection
  options?: Pick<CrossSectionOptions, "panelsPerEdge" | "interfaceExtent">
}): Matrix {
  validateCrossSection(crossSection)
  const count = options.panelsPerEdge ?? DEFAULT_PANELS_PER_EDGE
  const extent = options.interfaceExtent ?? DEFAULT_INTERFACE_EXTENT
  if (!hasValidMeshOptions({ count, extent }))
    fail(
      "cross_section_options",
      "Use >=6 panels per edge and interface extent >=4",
    )
  const capacitanceFaradsPerMeter = crossSection.conductors.map(() =>
    crossSection.conductors.map(() => 0),
  )
  for (const { region, conductorIndices } of partitionCrossSection(
    crossSection,
  )) {
    const field = calculateRegionField({
      region,
      count,
      extent,
      includeDielectricLoss: false,
    })
    for (const [i, globalRow] of conductorIndices.entries()) {
      for (const [j, globalColumn] of conductorIndices.entries())
        capacitanceFaradsPerMeter[globalRow][globalColumn] =
          field.capacitanceFaradsPerMeter[i][j]
    }
  }
  assertMatrixPassive({ matrix: capacitanceFaradsPerMeter, strict: true })
  return capacitanceFaradsPerMeter
}

/** Zero matrix in input conductor order. */
function zeroMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => Array(size).fill(0))
}

/** Calculate quasi-TEM matrices with layered dielectrics and Wheeler conductor loss. */
export function calculateRlgc({
  crossSection,
  options = {},
}: {
  crossSection: CrossSection
  options?: CrossSectionOptions
}): RlgcMatrices {
  validateCrossSection(crossSection)
  const count = options.panelsPerEdge ?? DEFAULT_PANELS_PER_EDGE
  const extent = options.interfaceExtent ?? DEFAULT_INTERFACE_EXTENT
  const fraction = options.recessionFraction ?? DEFAULT_RECESSION_FRACTION
  const hasValidRecessionFraction =
    Number.isFinite(fraction) &&
    fraction > 0 &&
    fraction <= MAX_RECESSION_FRACTION
  if (!hasValidMeshOptions({ count, extent }) || !hasValidRecessionFraction) {
    fail(
      "cross_section_options",
      "Use >=6 panels per edge, interface extent >=4 and recession fraction in (0, .1]",
    )
  }
  const size = crossSection.conductors.length
  const capacitanceFaradsPerMeter = zeroMatrix(size)
  const vacuumCapacitanceFaradsPerMeter = zeroMatrix(size)
  const externalInductanceHenriesPerMeter = zeroMatrix(size)
  const dielectricLossFaradsPerMeter = zeroMatrix(size)
  const totalSkinResistanceOhmsPerMeterPerSqrtHz = zeroMatrix(size)
  const conductorSkinResistanceOhmsPerMeterPerSqrtHz = zeroMatrix(size)
  const dcResistanceOhmsPerMeter = zeroMatrix(size)
  let panelCount = 0
  let residual = 0
  let recessionMm = Infinity
  for (const { region, conductorIndices } of partitionCrossSection(
    crossSection,
  )) {
    const mesh = { region, count, extent }
    const vacuumField = calculateRegionField({ ...mesh, isVacuum: true })
    const field = calculateRegionField(mesh)
    const external = calculateExternalInductance(
      vacuumField.capacitanceFaradsPerMeter,
    )
    const skin = calculateSkinCoefficients({ mesh, fraction })
    for (const [i, globalRow] of conductorIndices.entries()) {
      for (const [j, globalColumn] of conductorIndices.entries()) {
        capacitanceFaradsPerMeter[globalRow][globalColumn] =
          field.capacitanceFaradsPerMeter[i][j]
        vacuumCapacitanceFaradsPerMeter[globalRow][globalColumn] =
          vacuumField.capacitanceFaradsPerMeter[i][j]
        externalInductanceHenriesPerMeter[globalRow][globalColumn] =
          external[i][j]
        dielectricLossFaradsPerMeter[globalRow][globalColumn] = field.loss[i][j]
        totalSkinResistanceOhmsPerMeterPerSqrtHz[globalRow][globalColumn] =
          skin.totalSkinResistanceOhmsPerMeterPerSqrtHz[i][j]
        conductorSkinResistanceOhmsPerMeterPerSqrtHz[globalRow][globalColumn] =
          skin.conductorSkinResistanceOhmsPerMeterPerSqrtHz[i][j]
      }
    }
    panelCount += field.panelCount
    residual = Math.max(residual, field.residual, vacuumField.residual)
    recessionMm = Math.min(recessionMm, skin.recessionMm)
  }
  for (const matrix of [
    capacitanceFaradsPerMeter,
    vacuumCapacitanceFaradsPerMeter,
    externalInductanceHenriesPerMeter,
  ])
    assertMatrixPassive({ matrix, strict: true })
  for (const matrix of [
    dielectricLossFaradsPerMeter,
    totalSkinResistanceOhmsPerMeterPerSqrtHz,
    conductorSkinResistanceOhmsPerMeterPerSqrtHz,
  ])
    assertMatrixPassive({ matrix })
  for (const [i, c] of crossSection.conductors.entries()) {
    const conductivity = c.conductivitySm ?? defaultCopperConductivitySm
    dcResistanceOhmsPerMeter[i][i] =
      SQUARE_MILLIMETERS_PER_SQUARE_METER /
      (conductivity * c.widthMm * c.thicknessMm)
  }
  return {
    conductorIds: crossSection.conductors.map((c) => c.conductorId),
    capacitanceFaradsPerMeter,
    vacuumCapacitanceFaradsPerMeter,
    externalInductanceHenriesPerMeter,
    dielectricLossFaradsPerMeter,
    dcResistanceOhmsPerMeter,
    totalSkinResistanceOhmsPerMeterPerSqrtHz,
    conductorSkinResistanceOhmsPerMeterPerSqrtHz,
    diagnostics: { panelCount, reciprocityResidual: residual, recessionMm },
  }
}
