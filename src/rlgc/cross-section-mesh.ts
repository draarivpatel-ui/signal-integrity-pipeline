import {
  type BoundaryEdge,
  buildEdgePanels,
  calculateConductorFaceCounts,
  calculateHorizontalPanelCount,
  getMaterial,
  mergeCoordinates,
  planConductorEdges,
} from "./cross-section-edges"
import type { BoundaryPanel, RegionMeshInput } from "./cross-section-types"
import { fail } from "./diagnostics"

/** Sample just inside each material relative to the smallest feature in the cross-section. */
const MATERIAL_PROBE_FRACTION = 1e-7

/** Merge mesh coordinates at a tighter tolerance than the material probe offset. */
const COORDINATE_TOLERANCE_DIVISOR = 100

/** Bound each dense field matrix to fewer than ten million coefficients. */
const MAX_REGION_PANELS = 3072

/** Mesh a short vertical face at roughly one third of the horizontal panel count. */
const VERTICAL_PANEL_DIVISOR = 3

/** Keep at least four panels on a vertical edge to resolve its corners. */
const MIN_VERTICAL_PANELS = 4

/** A negative conductor index marks a dielectric interface row instead of a conductor excitation. */
const DIELECTRIC_INTERFACE = -1

/** Plan region edges before allocating any panels. */
function* planRegionEdges(mesh: RegionMeshInput): Iterable<BoundaryEdge> {
  const { region, panelsPerEdge, interfaceExtent, isVacuum } = mesh
  const conductorSpansMm = region.conductors.map((c) =>
    Math.max(c.widthMm, c.zMm + c.thicknessMm),
  )
  const dielectricTopsMm = region.dielectricLayers.map(
    (layer) => layer.zMm + layer.thicknessMm,
  )
  const scaleMm = Math.max(...conductorSpansMm, ...dielectricTopsMm)
  const conductorSizesMm = region.conductors.flatMap((c) => [
    c.widthMm,
    c.thicknessMm,
  ])
  const dielectricThicknessesMm = region.dielectricLayers.map(
    (layer) => layer.thicknessMm,
  )
  const materialProbeMm =
    Math.min(...conductorSizesMm, ...dielectricThicknessesMm) *
    MATERIAL_PROBE_FRACTION
  const coordinateToleranceMm = materialProbeMm / COORDINATE_TOLERANCE_DIVISOR
  let dielectricLayers = region.dielectricLayers
  if (isVacuum) dielectricLayers = []
  const verticalSteps = Math.max(
    MIN_VERTICAL_PANELS,
    Math.ceil(panelsPerEdge / VERTICAL_PANEL_DIVISOR),
  )
  const facePanelCounts =
    mesh.facePanelCounts ?? calculateConductorFaceCounts(mesh)
  for (const [conductorIndex, conductor] of region.conductors.entries()) {
    yield* planConductorEdges({
      verticalSteps,
      facePanelCount: facePanelCounts[conductorIndex],
      conductor,
      conductorIndex,
      dielectricLayers,
      materialProbeMm,
      coordinateToleranceMm,
    })
  }
  if (!dielectricLayers.length) return

  const conductorProjectionsMm = region.conductors.flatMap((c) => [
    c.xMm - c.widthMm / 2,
    c.xMm + c.widthMm / 2,
  ])
  // Between two grounded planes the first transverse mode decays by e per spacing / pi.
  let paddingMm = interfaceExtent * scaleMm
  if (region.planeSpacingMm)
    paddingMm = interfaceExtent * (region.planeSpacingMm / Math.PI)
  if (!Number.isFinite(paddingMm))
    fail({
      code: "mesh_panel_limit",
      text: "Nonfinite interface extent exceeds the mesh panel limit",
    })
  const startXMm = Math.min(...conductorProjectionsMm) - paddingMm
  const endXMm = Math.max(...conductorProjectionsMm) + paddingMm
  const edgeCoordinatesMm = mergeCoordinates({
    coordinatesMm: [startXMm, ...conductorProjectionsMm, endXMm],
    coordinateToleranceMm,
  })
  const dielectricBoundaryHeightsMm = dielectricLayers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const boundaries = mergeCoordinates({
    coordinatesMm: dielectricBoundaryHeightsMm,
    coordinateToleranceMm,
  }).filter((zMm) => {
    return (
      zMm > coordinateToleranceMm &&
      (!region.planeSpacingMm ||
        zMm < region.planeSpacingMm - coordinateToleranceMm)
    )
  })
  for (const zMm of boundaries) {
    const below = getMaterial({ dielectricLayers, zMm: zMm - materialProbeMm })
    const above = getMaterial({ dielectricLayers, zMm: zMm + materialProbeMm })
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
    for (let k = 1; k < edgeCoordinatesMm.length; k++) {
      const middleXMm = (edgeCoordinatesMm[k - 1] + edgeCoordinatesMm[k]) / 2
      const isCovered = region.conductors.some((c) => {
        const isWithinWidth =
          middleXMm > c.xMm - c.widthMm / 2 && middleXMm < c.xMm + c.widthMm / 2
        return (
          isWithinWidth &&
          zMm >= c.zMm - materialProbeMm &&
          zMm <= c.zMm + c.thicknessMm + materialProbeMm
        )
      })
      if (isCovered) continue
      let steps = panelsPerEdge
      if (region.planeSpacingMm) {
        steps = calculateHorizontalPanelCount({
          panelsPerEdge,
          lengthMm: edgeCoordinatesMm[k] - edgeCoordinatesMm[k - 1],
          clearanceMm: Math.min(zMm, region.planeSpacingMm - zMm),
        })
      }
      yield {
        startXMm: edgeCoordinatesMm[k - 1],
        startZMm: zMm,
        endXMm: edgeCoordinatesMm[k],
        endZMm: zMm,
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
      fail({
        code: "mesh_panel_limit",
        text: `Cross-section region exceeds the panel limit of ${MAX_REGION_PANELS} (at least ${panelCount} requested). Reduce the resolution or interface extent.`,
      })
    }
    edges.push(edge)
  }
  return edges.flatMap(buildEdgePanels)
}
