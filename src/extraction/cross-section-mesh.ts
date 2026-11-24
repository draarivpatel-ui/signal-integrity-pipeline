import { defaultCopperConductivitySm } from "../board"
import { hypotenuse } from "../kernel"
import type {
  CrossSection,
  SectionConductor,
  SectionDielectric,
  SectionMeshInput,
  SectionPanel,
  SectionRegion,
} from "./cross-section-types"
import { fail } from "./diagnostics"

/** Ignore sub-femtometer differences between slab boundaries after projection or clipping, in millimeters. */
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

/** Negative group marks a dielectric interface row instead of a conductor excitation. */
const DIELECTRIC_GROUP = -1

/** Relative permittivity and loss tangent of the material at a boundary. */
type SectionMaterial = Pick<SectionDielectric, "er" | "lossTangent">

/** Material adjacent to a boundary; non-overlapping slabs leave air elsewhere. */
function material({
  layers,
  z,
}: {
  layers: SectionDielectric[]
  z: number
}): SectionMaterial {
  return (
    layers.find(
      (layer) => z > layer.zMm && z < layer.zMm + layer.thicknessMm,
    ) ?? { er: 1, lossTangent: 0 }
  )
}

/** Merge floating-point copies of one boundary before making panels; never create zero-size seams. */
function coordinates({
  coordinatesMm,
  tolerance,
}: {
  coordinatesMm: number[]
  tolerance: number
}): number[] {
  return [...coordinatesMm]
    .sort((a, b) => a - b)
    .filter(
      (coordinateMm, i, sorted) =>
        !i || coordinateMm - sorted[i - 1] > tolerance,
    )
}

/** A shielded region and its conductor indices in the original cross-section. */
interface IndexedSectionRegion {
  region: SectionRegion
  indices: number[]
}

/** Reflect an upper-only reference, and split signals into regions shielded by solid planes. */
export function sectionRegions(section: CrossSection): IndexedSectionRegion[] {
  const planes = [...section.planes].sort((a, b) => a.zMm - b.zMm)
  const groups = new Map<number, number[]>()
  for (const [i, conductor] of section.conductors.entries()) {
    const key = planes.filter((plane) => plane.zMm < conductor.zMm).length
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  return [...groups].map(([key, indices]) => {
    const below = planes[key - 1]
    const above = planes[key]
    const origin = below?.zMm ?? above.zMm
    const lower = below ?? above
    const conductors = indices.map((i) => {
      const c = section.conductors[i]
      if (below) return { ...c, zMm: c.zMm - origin }
      return { ...c, zMm: origin - c.zMm - c.thicknessMm }
    })
    let height = 0
    if (below && above) height = above.zMm - below.zMm
    const dielectrics = section.dielectrics
      .map((layer) => {
        let lowMm = Math.max(0, layer.zMm - origin)
        let highMm = Math.min(
          height || Infinity,
          layer.zMm + layer.thicknessMm - origin,
        )
        if (!below) {
          lowMm = Math.max(0, origin - layer.zMm - layer.thicknessMm)
          highMm = Math.min(height || Infinity, origin - layer.zMm)
        }
        return { ...layer, zMm: lowMm, thicknessMm: highMm - lowMm }
      })
      .filter((layer) => layer.thicknessMm > DIELECTRIC_BOUNDARY_TOLERANCE_MM)
    return {
      indices,
      region: {
        conductors,
        dielectrics,
        height,
        lowerConductivity: lower.conductivitySm ?? defaultCopperConductivitySm,
        upperConductivity: above?.conductivitySm ?? defaultCopperConductivitySm,
      },
    }
  })
}

/** Segment geometry and material for a conductor or dielectric edge. */
interface SectionEdge {
  x1: number
  z1: number
  x2: number
  z2: number
  group: number
  er: number
  lossTangent: number
  contrast?: number
  derivative?: number
  steps: number
}

/** Number of graded panels on a horizontal edge at the requested resolution. */
function horizontalSteps({
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
export function sectionConductorFaceSteps({
  region,
  count,
}: SectionMeshInput): number[] {
  return region.conductors.map((conductor) => {
    let clearanceMm = conductor.zMm
    if (region.height) {
      clearanceMm = Math.min(
        clearanceMm,
        region.height - conductor.zMm - conductor.thicknessMm,
      )
    }
    return horizontalSteps({ count, lengthMm: conductor.widthMm, clearanceMm })
  })
}

/** Quartic grading resolves the integrable corner charge singularity. */
function panelFraction({ i, steps }: { i: number; steps: number }): number {
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
  group,
  er,
  lossTangent,
  contrast = 0,
  derivative = 0,
  steps,
}: SectionEdge): SectionPanel[] {
  const result: SectionPanel[] = []
  const dx = x2 - x1
  const dz = z2 - z1
  const length = hypotenuse(dx, dz)
  for (let i = 0; i < steps; i++) {
    const startFraction = panelFraction({ i, steps })
    const endFraction = panelFraction({ i: i + 1, steps })
    result.push({
      x: x1 + (dx * (startFraction + endFraction)) / 2,
      z: z1 + (dz * (startFraction + endFraction)) / 2,
      tx: dx / length,
      tz: dz / length,
      length: length * (endFraction - startFraction),
      group,
      er,
      tangent: lossTangent,
      contrast,
      derivative,
    })
  }
  return result
}

/** Plan one conductor's faces, splitting the sides wherever dielectric material changes. */
function planConductorEdges({
  verticalSteps,
  faceSteps,
  conductor,
  group,
  layers,
  probe,
  tolerance,
}: {
  verticalSteps: number
  faceSteps: number
  conductor: SectionConductor
  group: number
  layers: SectionDielectric[]
  probe: number
  tolerance: number
}): SectionEdge[] {
  const bottom = conductor.zMm
  const top = bottom + conductor.thicknessMm
  const left = conductor.xMm - conductor.widthMm / 2
  const right = conductor.xMm + conductor.widthMm / 2
  const bottomMaterial = material({ layers, z: bottom - probe })
  const topMaterial = material({ layers, z: top + probe })
  const edges: SectionEdge[] = [
    {
      x1: left,
      z1: bottom,
      x2: right,
      z2: bottom,
      group,
      ...bottomMaterial,
      steps: faceSteps,
    },
    {
      x1: right,
      z1: top,
      x2: left,
      z2: top,
      group,
      ...topMaterial,
      steps: faceSteps,
    },
  ]
  const boundaries = layers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const interior = boundaries.filter(
    (z) => z > bottom + tolerance && z < top - tolerance,
  )
  const cuts = coordinates({
    coordinatesMm: [bottom, top, ...interior],
    tolerance,
  })
  for (let k = 1; k < cuts.length; k++) {
    const adjacent = material({ layers, z: (cuts[k - 1] + cuts[k]) / 2 })
    edges.push({
      x1: right,
      z1: cuts[k - 1],
      x2: right,
      z2: cuts[k],
      group,
      ...adjacent,
      steps: verticalSteps,
    })
    edges.push({
      x1: left,
      z1: cuts[k],
      x2: left,
      z2: cuts[k - 1],
      group,
      ...adjacent,
      steps: verticalSteps,
    })
  }
  return edges
}

/** Plan region edges before allocating any panels. */
function* planRegionEdges(mesh: SectionMeshInput): Iterable<SectionEdge> {
  const { region, count, extent, vacuum } = mesh
  const conductorSpans = region.conductors.map((c) =>
    Math.max(c.widthMm, c.zMm + c.thicknessMm),
  )
  const slabTops = region.dielectrics.map(
    (layer) => layer.zMm + layer.thicknessMm,
  )
  const scale = Math.max(...conductorSpans, ...slabTops)
  const conductorSizes = region.conductors.flatMap((c) => [
    c.widthMm,
    c.thicknessMm,
  ])
  const slabThicknesses = region.dielectrics.map((layer) => layer.thicknessMm)
  const probe =
    Math.min(...conductorSizes, ...slabThicknesses) * MATERIAL_PROBE_FRACTION
  const tolerance = probe / COORDINATE_TOLERANCE_DIVISOR
  let layers = region.dielectrics
  if (vacuum) layers = []
  const verticalSteps = Math.max(
    MIN_VERTICAL_PANELS,
    Math.ceil(count / VERTICAL_PANEL_DIVISOR),
  )
  const faceSteps = mesh.faceSteps ?? sectionConductorFaceSteps(mesh)
  for (const [group, conductor] of region.conductors.entries()) {
    yield* planConductorEdges({
      verticalSteps,
      faceSteps: faceSteps[group],
      conductor,
      group,
      layers,
      probe,
      tolerance,
    })
  }
  if (!layers.length) return

  const projections = region.conductors.flatMap((c) => [
    c.xMm - c.widthMm / 2,
    c.xMm + c.widthMm / 2,
  ])
  // Between two grounded planes the first transverse mode decays by e per spacing / pi.
  let padding = extent * scale
  if (region.height) padding = extent * (region.height / Math.PI)
  if (!Number.isFinite(padding))
    fail(
      "mesh_panel_limit",
      "Nonfinite interface extent exceeds the mesh panel limit",
    )
  const first = Math.min(...projections) - padding
  const last = Math.max(...projections) + padding
  const xs = coordinates({
    coordinatesMm: [first, ...projections, last],
    tolerance,
  })
  const slabBoundaries = layers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const boundaries = coordinates({
    coordinatesMm: slabBoundaries,
    tolerance,
  }).filter((z) => {
    return z > tolerance && (!region.height || z < region.height - tolerance)
  })
  for (const z of boundaries) {
    const below = material({ layers, z: z - probe })
    const above = material({ layers, z: z + probe })
    if (below.er === above.er && below.lossTangent === above.lossTangent)
      continue
    const permittivitySum = below.er + above.er
    const contrast = (2 * (below.er - above.er)) / permittivitySum
    const derivative =
      (4 * below.er * above.er * (below.lossTangent - above.lossTangent)) /
      permittivitySum ** 2
    for (let k = 1; k < xs.length; k++) {
      const middle = (xs[k - 1] + xs[k]) / 2
      const covered = region.conductors.some((c) => {
        const withinWidth =
          middle > c.xMm - c.widthMm / 2 && middle < c.xMm + c.widthMm / 2
        return (
          withinWidth &&
          z >= c.zMm - probe &&
          z <= c.zMm + c.thicknessMm + probe
        )
      })
      if (covered) continue
      let steps = count
      if (region.height) {
        steps = horizontalSteps({
          count,
          lengthMm: xs[k] - xs[k - 1],
          clearanceMm: Math.min(z, region.height - z),
        })
      }
      yield {
        x1: xs[k - 1],
        z1: z,
        x2: xs[k],
        z2: z,
        group: DIELECTRIC_GROUP,
        er: 1,
        lossTangent: 0,
        contrast,
        derivative,
        steps,
      }
    }
  }
}

/** Build quartically graded panels, or reject an oversized region before panel allocation. */
export function sectionPanels(mesh: SectionMeshInput): SectionPanel[] {
  const edges: SectionEdge[] = []
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
