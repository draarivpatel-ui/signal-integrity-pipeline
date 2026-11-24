import { hypotenuse } from "../kernel"
import type {
  BoundaryPanel,
  CrossSectionConductor,
  CrossSectionDielectricLayer,
  RegionMeshInput,
} from "./cross-section-types"

/** Grade panels toward the ends of each edge with a quartic distribution. */
const PANEL_GRADING_POWER = 4

/** Start increasing panel count at six plane distances of horizontal conductor face. */
const FACE_LENGTH_IN_PLANE_DISTANCES = 6

/** Relative permittivity and loss tangent of the material at a boundary. */
type BoundaryMaterial = Pick<
  CrossSectionDielectricLayer,
  "relativePermittivity" | "lossTangent"
>

/** Material adjacent to a boundary; non-overlapping dielectric layers leave air elsewhere. */
export function getMaterial({
  dielectricLayers,
  z,
}: {
  dielectricLayers: CrossSectionDielectricLayer[]
  z: number
}): BoundaryMaterial {
  return (
    dielectricLayers.find(
      (layer) => z > layer.zMm && z < layer.zMm + layer.thicknessMm,
    ) ?? { relativePermittivity: 1, lossTangent: 0 }
  )
}

/** Merge floating-point copies of one boundary before making panels; never create zero-size seams. */
export function mergeCoordinates({
  coordinatesMm,
  coordinateToleranceMm,
}: {
  coordinatesMm: number[]
  coordinateToleranceMm: number
}): number[] {
  return [...coordinatesMm]
    .sort((a, b) => a - b)
    .filter(
      (coordinateMm, i, sorted) =>
        !i || coordinateMm - sorted[i - 1] > coordinateToleranceMm,
    )
}

/** Segment geometry and material for a conductor or dielectric edge. */
export interface BoundaryEdge {
  x1: number
  z1: number
  x2: number
  z2: number
  conductorIndex: number
  relativePermittivity: number
  lossTangent: number
  permittivityContrast?: number
  contrastLossDerivative?: number
  steps: number
}

/** Number of graded panels on a horizontal edge at the requested resolution. */
export function calculateHorizontalPanelCount({
  count,
  lengthMm,
  clearanceMm,
}: {
  count: number
  lengthMm: number
  clearanceMm: number
}): number {
  return Math.max(
    count,
    Math.ceil(
      (count * lengthMm) / (FACE_LENGTH_IN_PLANE_DISTANCES * clearanceMm),
    ),
  )
}

/** Horizontal face counts in conductor order, reusable across vacuum wall displacements. */
export function calculateConductorFaceCounts({
  region,
  count,
}: RegionMeshInput): number[] {
  return region.conductors.map((conductor) => {
    let clearanceMm = conductor.zMm
    if (region.planeSpacingMm) {
      clearanceMm = Math.min(
        clearanceMm,
        region.planeSpacingMm - conductor.zMm - conductor.thicknessMm,
      )
    }
    return calculateHorizontalPanelCount({
      count,
      lengthMm: conductor.widthMm,
      clearanceMm,
    })
  })
}

/** Quartic grading resolves the integrable corner charge singularity. */
function calculatePanelFraction({
  i,
  steps,
}: {
  i: number
  steps: number
}): number {
  const start = i ** PANEL_GRADING_POWER
  const end = (steps - i) ** PANEL_GRADING_POWER
  return start / (start + end)
}

/** Build panels along a straight edge with its outward metal normal. */
export function buildEdgePanels({
  x1,
  z1,
  x2,
  z2,
  conductorIndex,
  relativePermittivity,
  lossTangent,
  permittivityContrast = 0,
  contrastLossDerivative = 0,
  steps,
}: BoundaryEdge): BoundaryPanel[] {
  const result: BoundaryPanel[] = []
  const dx = x2 - x1
  const dz = z2 - z1
  const length = hypotenuse(dx, dz)
  for (let i = 0; i < steps; i++) {
    const startFraction = calculatePanelFraction({ i, steps })
    const endFraction = calculatePanelFraction({ i: i + 1, steps })
    result.push({
      centerXMm: x1 + (dx * (startFraction + endFraction)) / 2,
      centerZMm: z1 + (dz * (startFraction + endFraction)) / 2,
      tangentX: dx / length,
      tangentZ: dz / length,
      lengthMm: length * (endFraction - startFraction),
      conductorIndex,
      relativePermittivity,
      lossTangent,
      permittivityContrast,
      contrastLossDerivative,
    })
  }
  return result
}

/** Plan one conductor's faces, splitting the sides wherever dielectric material changes. */
export function planConductorEdges({
  verticalSteps,
  facePanelCounts,
  conductor,
  conductorIndex,
  dielectricLayers,
  materialProbeMm,
  coordinateToleranceMm,
}: {
  verticalSteps: number
  facePanelCounts: number
  conductor: CrossSectionConductor
  conductorIndex: number
  dielectricLayers: CrossSectionDielectricLayer[]
  materialProbeMm: number
  coordinateToleranceMm: number
}): BoundaryEdge[] {
  const bottom = conductor.zMm
  const top = bottom + conductor.thicknessMm
  const left = conductor.xMm - conductor.widthMm / 2
  const right = conductor.xMm + conductor.widthMm / 2
  const bottomMaterial = getMaterial({
    dielectricLayers,
    z: bottom - materialProbeMm,
  })
  const topMaterial = getMaterial({
    dielectricLayers,
    z: top + materialProbeMm,
  })
  const edges: BoundaryEdge[] = [
    {
      x1: left,
      z1: bottom,
      x2: right,
      z2: bottom,
      conductorIndex,
      ...bottomMaterial,
      steps: facePanelCounts,
    },
    {
      x1: right,
      z1: top,
      x2: left,
      z2: top,
      conductorIndex,
      ...topMaterial,
      steps: facePanelCounts,
    },
  ]
  const boundaries = dielectricLayers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const interior = boundaries.filter(
    (z) =>
      z > bottom + coordinateToleranceMm && z < top - coordinateToleranceMm,
  )
  const sidewallBoundaryHeightsMm = mergeCoordinates({
    coordinatesMm: [bottom, top, ...interior],
    coordinateToleranceMm,
  })
  for (let k = 1; k < sidewallBoundaryHeightsMm.length; k++) {
    const adjacent = getMaterial({
      dielectricLayers,
      z: (sidewallBoundaryHeightsMm[k - 1] + sidewallBoundaryHeightsMm[k]) / 2,
    })
    edges.push({
      x1: right,
      z1: sidewallBoundaryHeightsMm[k - 1],
      x2: right,
      z2: sidewallBoundaryHeightsMm[k],
      conductorIndex,
      ...adjacent,
      steps: verticalSteps,
    })
    edges.push({
      x1: left,
      z1: sidewallBoundaryHeightsMm[k],
      x2: left,
      z2: sidewallBoundaryHeightsMm[k - 1],
      conductorIndex,
      ...adjacent,
      steps: verticalSteps,
    })
  }
  return edges
}
