import { defaultCopperConductivitySm } from "../board"
import { hypotenuse } from "../kernel"
import { sectionField } from "./cross-section-field"
import { sectionInverse } from "./cross-section-matrix"
import { sectionConductorFaceSteps } from "./cross-section-mesh"
import {
  type SectionMeshInput,
  type SectionRegion,
  sectionEpsilon0,
  sectionMu0,
} from "./cross-section-types"
import { fail } from "./diagnostics"
import { type Matrix, symmetrize } from "./linalg"

/** Wall displacement is in millimeters and resistance is computed in SI units. */
const MILLIMETERS_PER_METER = 1000

/** High-frequency external inductance from the vacuum Maxwell capacitance. */
export function inductance(C0: Matrix): Matrix {
  return symmetrize(
    sectionInverse(C0).map((row) =>
      row.map((coefficient) => sectionMu0 * sectionEpsilon0 * coefficient),
    ),
  )
}

/** Recede every conducting wall (or only the signal conductors' walls) away from the field, weighted by its surface
 * resistivity. Vacuum is essential: moving a wall must not change the electrical dielectric geometry.
 */
function recede({
  region,
  distance,
  fixedPlanes = false,
}: {
  region: SectionRegion
  distance: number
  fixedPlanes?: boolean
}): SectionRegion {
  let lower = 0
  let upper = 0
  if (!fixedPlanes) {
    lower =
      distance *
      Math.sqrt(defaultCopperConductivitySm / region.lowerConductivity)
    upper =
      distance *
      Math.sqrt(defaultCopperConductivitySm / region.upperConductivity)
  }
  let height = 0
  if (region.height) height = region.height + lower + upper
  if (
    !fixedPlanes &&
    (lower === 0 || (region.height && height === region.height))
  ) {
    fail(
      "cross_section_options",
      "Recession displacement is too small to move the reference planes",
    )
  }
  const conductors = region.conductors.map((c) => {
    const shift =
      distance *
      Math.sqrt(
        defaultCopperConductivitySm /
          (c.conductivitySm ?? defaultCopperConductivitySm),
      )
    const widthMm = c.widthMm - 2 * shift
    const thicknessMm = c.thicknessMm - 2 * shift
    const zMm = c.zMm + shift + lower
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
    dielectrics: [],
    height,
    conductors,
  }
}

/** Bound wall recession by trace dimensions, dielectric gaps and surface resistivity. */
function recessionStep({
  region,
  fraction,
}: {
  region: SectionRegion
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
    if (region.height) spans.push(region.height - c.zMm - c.thicknessMm)
    return spans
  })
  const scale = Math.min(
    ...conductorSpans.map((span) => span / 2),
    ...gaps.map((gap) => gap / 4),
  )
  const lowerWeight = Math.sqrt(
    defaultCopperConductivitySm / region.lowerConductivity,
  )
  const upperWeight = Math.sqrt(
    defaultCopperConductivitySm / region.upperConductivity,
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
function wheeler({
  plus,
  minus,
  step,
}: {
  plus: number
  minus: number
  step: number
}): number {
  const gradient = (plus - minus) / ((2 * step) / MILLIMETERS_PER_METER)
  return (
    (gradient *
      Math.sqrt((Math.PI * sectionMu0) / defaultCopperConductivitySm)) /
    sectionMu0
  )
}

/** Compute external inductance after displacing the requested conducting walls. */
function recededInductance({
  mesh,
  region,
}: {
  mesh: SectionMeshInput
  region: SectionRegion
}): Matrix {
  return inductance(sectionField({ ...mesh, region, vacuum: true }).C)
}

/** Skin coefficients from all walls and from conductor walls alone. */
interface SkinCoefficients {
  skinResistance: Matrix
  stripSkinResistance: Matrix
  recessionMm: number
}

/** Differentiate the inductance on the same vacuum mesh for all four displacements. */
export function calculateSkinCoefficients({
  mesh,
  fraction,
}: {
  mesh: SectionMeshInput
  fraction: number
}): SkinCoefficients {
  const { region } = mesh
  const step = recessionStep({ region, fraction })
  const tighterRegion = recede({ region, distance: -step })
  // Closing both reference gaps gives the highest horizontal panel count of the four perturbations.
  const faceSteps = sectionConductorFaceSteps({
    ...mesh,
    region: tighterRegion,
  })
  const lossMesh = { ...mesh, faceSteps }
  const totalPlus = recededInductance({
    mesh: lossMesh,
    region: recede({ region, distance: step }),
  })
  const totalMinus = recededInductance({
    mesh: lossMesh,
    region: tighterRegion,
  })
  const conductorPlus = recededInductance({
    mesh: lossMesh,
    region: recede({ region, distance: step, fixedPlanes: true }),
  })
  const conductorMinus = recededInductance({
    mesh: lossMesh,
    region: recede({ region, distance: -step, fixedPlanes: true }),
  })
  return {
    skinResistance: totalPlus.map((row, i) =>
      row.map((coefficient, j) =>
        wheeler({ plus: coefficient, minus: totalMinus[i][j], step }),
      ),
    ),
    stripSkinResistance: conductorPlus.map((row, i) =>
      row.map((coefficient, j) =>
        wheeler({ plus: coefficient, minus: conductorMinus[i][j], step }),
      ),
    ),
    recessionMm: step,
  }
}
