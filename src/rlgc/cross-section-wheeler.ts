import { defaultCopperConductivitySm } from "../board"
import { hypotenuse, type Matrix, symmetrize } from "../kernel"
import { calculateConductorFaceCounts } from "./cross-section-edges"
import { calculateRegionField } from "./cross-section-field"
import { calculateMatrixInverse } from "./cross-section-matrix"
import {
  type FieldRegion,
  type RegionMeshInput,
  VACUUM_PERMEABILITY_H_PER_M,
  VACUUM_PERMITTIVITY_F_PER_M,
} from "./cross-section-types"
import { fail } from "./diagnostics"

/** Wall displacement is in millimeters and resistance is computed in SI units. */
const MILLIMETERS_PER_METER = 1000

/** High-frequency external inductance from the vacuum Maxwell capacitance. */
export function calculateExternalInductance(
  vacuumCapacitanceFaradsPerMeter: Matrix,
): Matrix {
  return symmetrize(
    calculateMatrixInverse(vacuumCapacitanceFaradsPerMeter).map((row) =>
      row.map(
        (coefficient) =>
          VACUUM_PERMEABILITY_H_PER_M *
          VACUUM_PERMITTIVITY_F_PER_M *
          coefficient,
      ),
    ),
  )
}

/** Recede every conducting wall (or only the signal conductors' walls) away from the field, weighted by its surface
 * resistivity. Vacuum is essential: moving a wall must not change the electrical dielectric geometry.
 */
function recedeWalls({
  region,
  displacementMm,
  keepPlanesFixed = false,
}: {
  region: FieldRegion
  displacementMm: number
  keepPlanesFixed?: boolean
}): FieldRegion {
  let lowerPlaneOffsetMm = 0
  let upperPlaneOffsetMm = 0
  if (!keepPlanesFixed) {
    lowerPlaneOffsetMm =
      displacementMm *
      Math.sqrt(defaultCopperConductivitySm / region.lowerPlaneConductivitySm)
    upperPlaneOffsetMm =
      displacementMm *
      Math.sqrt(defaultCopperConductivitySm / region.upperPlaneConductivitySm)
  }
  let planeSpacingMm = 0
  if (region.planeSpacingMm)
    planeSpacingMm =
      region.planeSpacingMm + lowerPlaneOffsetMm + upperPlaneOffsetMm
  if (
    !keepPlanesFixed &&
    (lowerPlaneOffsetMm === 0 ||
      (region.planeSpacingMm && planeSpacingMm === region.planeSpacingMm))
  ) {
    fail(
      "cross_section_options",
      "Recession displacement is too small to move the reference planes",
    )
  }
  const conductors = region.conductors.map((c) => {
    const shift =
      displacementMm *
      Math.sqrt(
        defaultCopperConductivitySm /
          (c.conductivitySm ?? defaultCopperConductivitySm),
      )
    const widthMm = c.widthMm - 2 * shift
    const thicknessMm = c.thicknessMm - 2 * shift
    const zMm = c.zMm + shift + lowerPlaneOffsetMm
    if (
      widthMm === c.widthMm ||
      thicknessMm === c.thicknessMm ||
      zMm === c.zMm
    ) {
      fail(
        "cross_section_options",
        "Recession displacement is too small to move the conductor walls",
      )
    }
    return { ...c, widthMm, thicknessMm, zMm }
  })
  return {
    ...region,
    dielectricLayers: [],
    planeSpacingMm,
    conductors,
  }
}

/** Bound wall recession by trace dimensions, dielectric gaps and surface resistivity. */
function calculateRecessionMm({
  region,
  fraction,
}: {
  region: FieldRegion
  fraction: number
}): number {
  const gaps = region.conductors.flatMap((a, i) =>
    region.conductors.slice(i + 1).map((b) => {
      const horizontal = Math.max(
        0,
        Math.abs(a.xMm - b.xMm) - (a.widthMm + b.widthMm) / 2,
      )
      const vertical = Math.max(
        0,
        a.zMm - b.zMm - b.thicknessMm,
        b.zMm - a.zMm - a.thicknessMm,
      )
      return hypotenuse(horizontal, vertical)
    }),
  )
  const conductorSpans = region.conductors.flatMap((c) => {
    const spans = [c.widthMm, c.thicknessMm, c.zMm]
    if (region.planeSpacingMm)
      spans.push(region.planeSpacingMm - c.zMm - c.thicknessMm)
    return spans
  })
  const scale = Math.min(
    ...conductorSpans.map((span) => span / 2),
    ...gaps.map((gap) => gap / 4),
  )
  const lowerWeight = Math.sqrt(
    defaultCopperConductivitySm / region.lowerPlaneConductivitySm,
  )
  const upperWeight = Math.sqrt(
    defaultCopperConductivitySm / region.upperPlaneConductivitySm,
  )
  const conductorWeights = region.conductors.map((c) => {
    return Math.sqrt(
      defaultCopperConductivitySm /
        (c.conductivitySm ?? defaultCopperConductivitySm),
    )
  })
  const weight = Math.max(1, lowerWeight, upperWeight, ...conductorWeights)
  return (fraction * scale) / weight
}

/** Wheeler resistance per sqrt(Hz) from inductances with walls receded by +step and -step. */
function calculateWheelerCoefficient({
  plus,
  minus,
  recessionMm,
}: {
  plus: number
  minus: number
  recessionMm: number
}): number {
  const gradient = (plus - minus) / ((2 * recessionMm) / MILLIMETERS_PER_METER)
  return (
    (gradient *
      Math.sqrt(
        (Math.PI * VACUUM_PERMEABILITY_H_PER_M) / defaultCopperConductivitySm,
      )) /
    VACUUM_PERMEABILITY_H_PER_M
  )
}

/** Compute external inductance after displacing the requested conducting walls. */
function calculateRecededInductance({
  mesh,
  region,
}: {
  mesh: RegionMeshInput
  region: FieldRegion
}): Matrix {
  return calculateExternalInductance(
    calculateRegionField({ ...mesh, region, isVacuum: true })
      .capacitanceFaradsPerMeter,
  )
}

/** Skin coefficients from all walls and from conductor walls alone. */
interface SkinCoefficients {
  totalSkinResistanceOhmsPerMeterPerSqrtHz: Matrix
  conductorSkinResistanceOhmsPerMeterPerSqrtHz: Matrix
  recessionMm: number
}

/** Differentiate the inductance on the same vacuum mesh for all four displacements. */
export function calculateSkinCoefficients({
  mesh,
  fraction,
}: {
  mesh: RegionMeshInput
  fraction: number
}): SkinCoefficients {
  const { region } = mesh
  const recessionMm = calculateRecessionMm({ region, fraction })
  const tighterRegion = recedeWalls({ region, displacementMm: -recessionMm })
  // Closing both reference gaps gives the highest horizontal panel count of the four perturbations.
  const facePanelCounts = calculateConductorFaceCounts({
    ...mesh,
    region: tighterRegion,
  })
  const lossMesh = { ...mesh, facePanelCounts }
  const totalPlus = calculateRecededInductance({
    mesh: lossMesh,
    region: recedeWalls({ region, displacementMm: recessionMm }),
  })
  const totalMinus = calculateRecededInductance({
    mesh: lossMesh,
    region: tighterRegion,
  })
  const conductorPlus = calculateRecededInductance({
    mesh: lossMesh,
    region: recedeWalls({
      region,
      displacementMm: recessionMm,
      keepPlanesFixed: true,
    }),
  })
  const conductorMinus = calculateRecededInductance({
    mesh: lossMesh,
    region: recedeWalls({
      region,
      displacementMm: -recessionMm,
      keepPlanesFixed: true,
    }),
  })
  return {
    totalSkinResistanceOhmsPerMeterPerSqrtHz: totalPlus.map((row, i) =>
      row.map((coefficient, j) =>
        calculateWheelerCoefficient({
          plus: coefficient,
          minus: totalMinus[i][j],
          recessionMm,
        }),
      ),
    ),
    conductorSkinResistanceOhmsPerMeterPerSqrtHz: conductorPlus.map((row, i) =>
      row.map((coefficient, j) =>
        calculateWheelerCoefficient({
          plus: coefficient,
          minus: conductorMinus[i][j],
          recessionMm,
        }),
      ),
    ),
    recessionMm: recessionMm,
  }
}
