import { defaultCopperConductivitySm } from "../board"
import { hypotenuse } from "../kernel"
import type {
  BoundaryPanel,
  CrossSection,
  CrossSectionConductor,
  CrossSectionDielectricLayer,
  FieldRegion,
  RegionMeshInput,
} from "./cross-section-types"
import { fail } from "./diagnostics"

/** Ignore sub-femtometer differences between dielectric boundaries after projection or clipping, in millimeters. */
export const DIELECTRIC_BOUNDARY_TOLERANCE_MM = 1e-12

/** Sample just inside each material relative to the smallest feature in the cross-section. */
const MATERIAL_PROBE_FRACTION = 1e-7

/** Merge mesh coordinates at a tighter tolerance than the material probe offset. */
const COORDINATE_TOLERANCE_DIVISOR = 100

/** Grade panels toward the ends of each edge with a quartic distribution. */
const PANEL_GRADING_POWER = 4

/** Start increasing panel count at six plane distances of horizontal conductor face. */
const FACE_LENGTH_IN_PLANE_DISTANCES = 6

/** Bound each dense field matrix to fewer than ten million coefficients. */
const MAX_REGION_PANELS = 3072

/** Mesh a short vertical face at roughly one third of the horizontal panel count. */
const VERTICAL_PANEL_DIVISOR = 3

/** Keep at least four panels on a vertical edge to resolve its corners. */
const MIN_VERTICAL_PANELS = 4

/** A negative conductor index marks a dielectric interface row instead of a conductor excitation. */
const DIELECTRIC_INTERFACE = -1

/** Relative permittivity and loss tangent of the material at a boundary. */
type BoundaryMaterial = Pick<
  CrossSectionDielectricLayer,
  "relativePermittivity" | "lossTangent"
>

/** Material adjacent to a boundary; non-overlapping dielectric layers leave air elsewhere. */
function getMaterial({
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
function mergeCoordinates({
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

/** A shielded region and its conductor indices in the original cross-section. */
interface IndexedFieldRegion {
  region: FieldRegion
  conductorIndices: number[]
}

/** Reflect an upper-only reference, and split conductors into regions shielded by solid planes. */
export function partitionCrossSection(
  crossSection: CrossSection,
): IndexedFieldRegion[] {
  const planes = [...crossSection.planes].sort((a, b) => a.zMm - b.zMm)
  const groups = new Map<number, number[]>()
  for (const [i, conductor] of crossSection.conductors.entries()) {
    const key = planes.filter((plane) => plane.zMm < conductor.zMm).length
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  return [...groups].map(([key, conductorIndices]) => {
    const below = planes[key - 1]
    const above = planes[key]
    const origin = below?.zMm ?? above.zMm
    const lower = below ?? above
    const conductors = conductorIndices.map((i) => {
      const c = crossSection.conductors[i]
      if (below) return { ...c, zMm: c.zMm - origin }
      return { ...c, zMm: origin - c.zMm - c.thicknessMm }
    })
    let planeSpacingMm = 0
    if (below && above) planeSpacingMm = above.zMm - below.zMm
    const dielectricLayers = crossSection.dielectricLayers
      .map((layer) => {
        let lowMm = Math.max(0, layer.zMm - origin)
        let highMm = Math.min(
          planeSpacingMm || Infinity,
          layer.zMm + layer.thicknessMm - origin,
        )
        if (!below) {
          lowMm = Math.max(0, origin - layer.zMm - layer.thicknessMm)
          highMm = Math.min(planeSpacingMm || Infinity, origin - layer.zMm)
        }
        return { ...layer, zMm: lowMm, thicknessMm: highMm - lowMm }
      })
      .filter((layer) => layer.thicknessMm > DIELECTRIC_BOUNDARY_TOLERANCE_MM)
    return {
      conductorIndices,
      region: {
        conductors,
        dielectricLayers,
        planeSpacingMm,
        lowerPlaneConductivitySm:
          lower.conductivitySm ?? defaultCopperConductivitySm,
        upperPlaneConductivitySm:
          above?.conductivitySm ?? defaultCopperConductivitySm,
      },
    }
  })
}

/** Segment geometry and material for a conductor or dielectric edge. */
interface BoundaryEdge {
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
function calculateHorizontalPanelCount({
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
function buildEdgePanels({
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
function planConductorEdges({
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

/** Plan region edges before allocating any panels. */
function* planRegionEdges(mesh: RegionMeshInput): Iterable<BoundaryEdge> {
  const { region, count, extent, isVacuum } = mesh
  const conductorSpans = region.conductors.map((c) =>
    Math.max(c.widthMm, c.zMm + c.thicknessMm),
  )
  const dielectricTopsMm = region.dielectricLayers.map(
    (layer) => layer.zMm + layer.thicknessMm,
  )
  const scale = Math.max(...conductorSpans, ...dielectricTopsMm)
  const conductorSizes = region.conductors.flatMap((c) => [
    c.widthMm,
    c.thicknessMm,
  ])
  const dielectricThicknessesMm = region.dielectricLayers.map(
    (layer) => layer.thicknessMm,
  )
  const materialProbeMm =
    Math.min(...conductorSizes, ...dielectricThicknessesMm) *
    MATERIAL_PROBE_FRACTION
  const coordinateToleranceMm = materialProbeMm / COORDINATE_TOLERANCE_DIVISOR
  let dielectricLayers = region.dielectricLayers
  if (isVacuum) dielectricLayers = []
  const verticalSteps = Math.max(
    MIN_VERTICAL_PANELS,
    Math.ceil(count / VERTICAL_PANEL_DIVISOR),
  )
  const facePanelCounts =
    mesh.facePanelCounts ?? calculateConductorFaceCounts(mesh)
  for (const [conductorIndex, conductor] of region.conductors.entries()) {
    yield* planConductorEdges({
      verticalSteps,
      facePanelCounts: facePanelCounts[conductorIndex],
      conductor,
      conductorIndex,
      dielectricLayers,
      materialProbeMm,
      coordinateToleranceMm,
    })
  }
  if (!dielectricLayers.length) return

  const projections = region.conductors.flatMap((c) => [
    c.xMm - c.widthMm / 2,
    c.xMm + c.widthMm / 2,
  ])
  // Between two grounded planes the first transverse mode decays by e per spacing / pi.
  let padding = extent * scale
  if (region.planeSpacingMm)
    padding = extent * (region.planeSpacingMm / Math.PI)
  if (!Number.isFinite(padding))
    fail(
      "mesh_panel_limit",
      "Nonfinite interface extent exceeds the mesh panel limit",
    )
  const first = Math.min(...projections) - padding
  const last = Math.max(...projections) + padding
  const xs = mergeCoordinates({
    coordinatesMm: [first, ...projections, last],
    coordinateToleranceMm,
  })
  const dielectricBoundaryHeightsMm = dielectricLayers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const boundaries = mergeCoordinates({
    coordinatesMm: dielectricBoundaryHeightsMm,
    coordinateToleranceMm,
  }).filter((z) => {
    return (
      z > coordinateToleranceMm &&
      (!region.planeSpacingMm ||
        z < region.planeSpacingMm - coordinateToleranceMm)
    )
  })
  for (const z of boundaries) {
    const below = getMaterial({ dielectricLayers, z: z - materialProbeMm })
    const above = getMaterial({ dielectricLayers, z: z + materialProbeMm })
    if (
      below.relativePermittivity === above.relativePermittivity &&
      below.lossTangent === above.lossTangent
    )
      continue
    const permittivitySum =
      below.relativePermittivity + above.relativePermittivity
    const permittivityContrast =
      (2 * (below.relativePermittivity - above.relativePermittivity)) /
      permittivitySum
    const contrastLossDerivative =
      (4 *
        below.relativePermittivity *
        above.relativePermittivity *
        (below.lossTangent - above.lossTangent)) /
      permittivitySum ** 2
    for (let k = 1; k < xs.length; k++) {
      const middle = (xs[k - 1] + xs[k]) / 2
      const isCovered = region.conductors.some((c) => {
        const withinWidth =
          middle > c.xMm - c.widthMm / 2 && middle < c.xMm + c.widthMm / 2
        return (
          withinWidth &&
          z >= c.zMm - materialProbeMm &&
          z <= c.zMm + c.thicknessMm + materialProbeMm
        )
      })
      if (isCovered) continue
      let steps = count
      if (region.planeSpacingMm) {
        steps = calculateHorizontalPanelCount({
          count,
          lengthMm: xs[k] - xs[k - 1],
          clearanceMm: Math.min(z, region.planeSpacingMm - z),
        })
      }
      yield {
        x1: xs[k - 1],
        z1: z,
        x2: xs[k],
        z2: z,
        conductorIndex: DIELECTRIC_INTERFACE,
        relativePermittivity: 1,
        lossTangent: 0,
        permittivityContrast,
        contrastLossDerivative,
        steps,
      }
    }
  }
}

/** Build quartically graded panels, or reject an oversized region before panel allocation. */
export function buildRegionPanels(mesh: RegionMeshInput): BoundaryPanel[] {
  const edges: BoundaryEdge[] = []
  let panelCount = 0
  for (const edge of planRegionEdges(mesh)) {
    panelCount += edge.steps
    if (!Number.isSafeInteger(panelCount) || panelCount > MAX_REGION_PANELS) {
      fail(
        "mesh_panel_limit",
        `Cross-section region exceeds the panel limit of ${MAX_REGION_PANELS} (at least ${panelCount} requested). Reduce the resolution or interface extent.`,
      )
    }
    edges.push(edge)
  }
  return edges.flatMap(buildEdgePanels)
}
