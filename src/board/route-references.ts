import { Line, Point, type PolygonEdge, Vector } from "@flatten-js/core"
import {
  getPourPolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import type { PcbCopperPour } from "circuit-json"
import { hypotenuse, type Snapshot } from "../kernel"
import { polygonContains } from "./geometry/polygon"
import type { CopperPoint } from "./geometry/types"
import type {
  ReferencePour,
  RouteReference,
  RouteSection,
  RouteWire,
  SectionGeometry,
} from "./route-section-types"
import {
  getRoutePoint,
  MIN_WIRE_LENGTH_MM,
  measureChordDistanceMm,
} from "./route-wire"
import type { CopperLayer } from "./stackup"

/** One micrometre limits the polygonal approximation of curved pour boundaries. */
const POUR_CHORD_TOLERANCE_MM = 0.001
/** Limit the edge approximation to the local neighborhood of ordinary board thicknesses. */
export const MAX_REFERENCE_EDGE_DISTANCE_MM = 2

/** Tessellate a pour edge with bounded sagitta, preserving its start and axis extrema. */
function samplePourEdge(edge: PolygonEdge): CopperPoint[] {
  const shape = edge.shape
  if (!("r" in shape)) return [[shape.start.x, shape.start.y]]
  return shape.breakToFunctional().flatMap((arc) => {
    const maxAngle =
      4 *
      Math.asin(Math.min(1, Math.sqrt(POUR_CHORD_TOLERANCE_MM / (2 * arc.r))))
    const steps = Math.max(1, Math.ceil(arc.sweep / maxAngle))
    if (!Number.isFinite(steps))
      throw new Error("Reference pour has an unusable arc")
    const points: CopperPoint[] = [[arc.start.x, arc.start.y]]
    for (let index = 1; index < steps; index++) {
      const point = arc.pointAtLength((index * arc.length) / steps)
      if (point) points.push([point.x, point.y])
    }
    return points
  })
}

type BrepPour = Extract<PcbCopperPour, { shape: "brep" }>
type BrepRing = BrepPour["brep_shape"]["outer_ring"]

/** Keep shallow arcs as chords before converting bulges to ill-conditioned circle centers. */
function flattenShallowArcs(ring: BrepRing): BrepRing {
  return {
    ...ring,
    vertices: ring.vertices.map((start, index) => {
      if (start.bulge === undefined) return start
      const end = ring.vertices[(index + 1) % ring.vertices.length]
      const chordMm = hypotenuse(end.x - start.x, end.y - start.y)
      if ((Math.abs(start.bulge) * chordMm) / 2 > POUR_CHORD_TOLERANCE_MM)
        return start
      return { ...start, bulge: 0 }
    }),
  }
}

/** Normalize all Circuit JSON pour encodings using the same geometry as copper scope. */
export function normalizeReferencePour(pour: PcbCopperPour): ReferencePour[] {
  if (pour.source_net_id === undefined) return []
  let referencePour = pour
  if (pour.shape === "brep") {
    const { outer_ring, inner_rings } = pour.brep_shape
    if (outer_ring.vertices.length < 2) return []
    referencePour = {
      ...pour,
      brep_shape: {
        outer_ring: flattenShallowArcs(outer_ring),
        inner_rings: inner_rings?.map(flattenShallowArcs),
      },
    }
  }
  const outline = getPourPolygon(referencePour)
  const polygon = [...outline.faces].map((face) =>
    face.edges.flatMap(samplePourEdge),
  )
  if (!polygon[0]?.length) return []
  return [
    {
      pcbCopperPourId: pour.pcb_copper_pour_id,
      sourceNetId: pour.source_net_id,
      layer: pour.layer,
      polygon,
    },
  ]
}

/** A reference candidate with the actual distance used to select it. */
interface ReferenceCandidate {
  reference: RouteReference
  distanceMm: number
}

/** The distance from the wire centerline to the copper outline, including holes. */
function measurePourGapMm({
  point,
  pour,
}: {
  point: CopperPoint
  pour: ReferencePour
}): number {
  let gapMm = Infinity
  for (const ring of pour.polygon) {
    for (const [index, startPoint] of ring.entries()) {
      const endPoint = ring[(index + 1) % ring.length]
      gapMm = Math.min(
        gapMm,
        measureChordDistanceMm({ point, startPoint, endPoint }),
      )
    }
  }
  return gapMm
}

/** An eligible reference and its position relative to the signal copper. */
interface ReferenceSurface {
  pour: ReferencePour
  reference: RouteReference
  isAboveSignal: boolean
  verticalGapMm: number
}

/** Resolve the nearer face of a reference layer. */
function getReferenceSurface({
  signal,
  pour,
  layer,
}: {
  signal: Snapshot<CopperLayer>
  pour: ReferencePour
  layer: Snapshot<CopperLayer>
}): ReferenceSurface {
  const isAboveSignal = layer.zMinMm > signal.zMaxMm
  let surfaceZMm = layer.zMaxMm
  let verticalGapMm = signal.zMinMm - surfaceZMm
  if (isAboveSignal) {
    surfaceZMm = layer.zMinMm
    verticalGapMm = surfaceZMm - signal.zMaxMm
  }
  return {
    pour,
    reference: {
      pcbCopperPourId: pour.pcbCopperPourId,
      sourceNetId: pour.sourceNetId,
      layer: pour.layer,
      surfaceZMm,
    },
    isAboveSignal,
    verticalGapMm,
  }
}

/** An interval along a section's canonical longitudinal axis, in millimetres. */
type LongitudinalInterval = Pick<RouteSection, "startMm" | "endMm">

/** Intersect a wire's axis with the capsule of points within range of one edge. */
function getEdgeInterval({
  line,
  direction,
  startPoint,
  endPoint,
  lateralLimitMm,
}: {
  line: Line
  direction: Snapshot<RouteWire["direction"]>
  startPoint: CopperPoint
  endPoint: CopperPoint
  lateralLimitMm: number
}): LongitudinalInterval | undefined {
  const capsule = getTraceSegmentPolygon(
    { x: startPoint[0], y: startPoint[1] },
    { x: endPoint[0], y: endPoint[1] },
    lateralLimitMm * 2,
  )
  const positionsMm = line
    .intersect(capsule)
    .map(({ x, y }) => x * direction[0] + y * direction[1])
  if (positionsMm.length < 2) return undefined
  return { startMm: Math.min(...positionsMm), endMm: Math.max(...positionsMm) }
}

/** A single pour must cover the entire edge-referenced interval, without gaps. */
function coversReferenceInterval({
  interval,
  wire,
  surface,
}: {
  interval: LongitudinalInterval
  wire: Snapshot<RouteWire>
  surface: ReferenceSurface
}): boolean {
  const lateralLimitMm = Math.sqrt(
    MAX_REFERENCE_EDGE_DISTANCE_MM ** 2 - surface.verticalGapMm ** 2,
  )
  const start = getRoutePoint({ wire, positionMm: interval.startMm })
  const end = getRoutePoint({ wire, positionMm: interval.endMm })
  if (
    measurePourGapMm({ point: start, pour: surface.pour }) >= lateralLimitMm ||
    measurePourGapMm({ point: end, pour: surface.pour }) >= lateralLimitMm
  )
    return false

  const [x, y] = wire.direction
  const line = new Line(new Point(...start), new Vector(-y, x))
  const spans = surface.pour.polygon
    .flatMap((ring) =>
      ring.flatMap((startPoint, index) => {
        const span = getEdgeInterval({
          line,
          direction: wire.direction,
          startPoint,
          endPoint: ring[(index + 1) % ring.length],
          lateralLimitMm,
        })
        if (!span) return []
        return [span]
      }),
    )
    .sort((first, second) => first.startMm - second.startMm)
  let coveredToMm = interval.startMm
  for (const span of spans) {
    if (span.startMm >= coveredToMm) break
    coveredToMm = Math.max(coveredToMm, span.endMm)
    if (coveredToMm > interval.endMm) return true
  }
  return false
}

/** Find the nearest reference edge when the centerline crosses no reference copper. */
function findEdgeReference({
  point,
  surfaces,
  signal,
  wire,
  interval,
}: {
  point: CopperPoint
  surfaces: ReferenceSurface[]
  signal: Snapshot<CopperLayer>
  wire: Snapshot<RouteWire>
  interval?: LongitudinalInterval
}): RouteReference[] {
  let nearest: ReferenceCandidate | undefined
  for (const surface of surfaces) {
    const { reference, pour, verticalGapMm, isAboveSignal } = surface
    const lateralGapMm = measurePourGapMm({ point, pour })
    const distanceMm = hypotenuse(verticalGapMm, lateralGapMm)
    if (distanceMm >= MAX_REFERENCE_EDGE_DISTANCE_MM) continue
    if (nearest && nearest.distanceMm <= distanceMm) continue
    if (interval && !coversReferenceInterval({ interval, wire, surface }))
      continue
    let surfaceZMm = signal.zMinMm - distanceMm
    if (isAboveSignal) surfaceZMm = signal.zMaxMm + distanceMm
    nearest = {
      reference: { ...reference, surfaceZMm, lateralGapMm },
      distanceMm,
    }
  }
  if (!nearest) return []
  return [nearest.reference]
}

/** Find the nearest occupied reference surface above and below the wire. */
export function findRouteReferences({
  geometry,
  wire,
  positionMm,
  interval,
}: {
  geometry: Pick<SectionGeometry, "stackup" | "pours">
  wire: Snapshot<RouteWire>
  positionMm: number
  interval?: LongitudinalInterval
}): RouteReference[] {
  const point = getRoutePoint({ wire, positionMm })
  const signal = geometry.stackup.copperLayers.find(
    (layer) => layer.name === wire.layer,
  )
  if (!signal)
    throw new Error(`${wire.pcbTraceId}: unknown copper layer ${wire.layer}`)
  const surfaces = geometry.pours.flatMap((pour) => {
    if (pour.layer === wire.layer) return []
    const layer = geometry.stackup.copperLayers.find(
      (copperLayer) => copperLayer.name === pour.layer,
    )
    if (!layer)
      throw new Error(
        `${pour.pcbCopperPourId}: unknown copper layer ${pour.layer}`,
      )
    return [getReferenceSurface({ signal, pour, layer })]
  })
  let above: ReferenceSurface | undefined
  let below: ReferenceSurface | undefined
  for (const surface of surfaces) {
    if (!polygonContains({ point, polygon: surface.pour.polygon })) continue
    if (surface.isAboveSignal) {
      if (!above || surface.verticalGapMm < above.verticalGapMm) above = surface
    } else if (!below || surface.verticalGapMm < below.verticalGapMm) {
      below = surface
    }
  }
  const occupied: RouteReference[] = []
  if (below) occupied.push(below.reference)
  if (above) occupied.push(above.reference)
  if (occupied.length) return occupied
  return findEdgeReference({ point, surfaces, signal, wire, interval })
}

/** Include vertices and endpoints of collinear edges; the sweep deduplicates shared positions. */
export function findReferenceBoundariesMm({
  wire,
  pours,
}: {
  wire: RouteWire
  pours: readonly ReferencePour[]
}): number[] {
  const [x, y] = wire.direction
  const boundariesMm: number[] = []
  for (const pour of pours) {
    if (pour.layer === wire.layer) continue
    for (const ring of pour.polygon) {
      for (const [index, startPoint] of ring.entries()) {
        const endPoint = ring[(index + 1) % ring.length]
        const startOffsetMm =
          -startPoint[0] * y + startPoint[1] * x - wire.lateralOffsetMm
        const endOffsetMm =
          -endPoint[0] * y + endPoint[1] * x - wire.lateralOffsetMm
        if (Math.abs(startOffsetMm) <= MIN_WIRE_LENGTH_MM)
          boundariesMm.push(startPoint[0] * x + startPoint[1] * y)
        if (
          (startOffsetMm < 0 && endOffsetMm > 0) ||
          (startOffsetMm > 0 && endOffsetMm < 0)
        ) {
          const fraction = startOffsetMm / (startOffsetMm - endOffsetMm)
          const crossingX =
            startPoint[0] + (endPoint[0] - startPoint[0]) * fraction
          const crossingY =
            startPoint[1] + (endPoint[1] - startPoint[1]) * fraction
          boundariesMm.push(crossingX * x + crossingY * y)
        }
      }
    }
  }
  return boundariesMm.filter(
    (positionMm) =>
      positionMm > wire.startMm + MIN_WIRE_LENGTH_MM &&
      positionMm < wire.endMm - MIN_WIRE_LENGTH_MM,
  )
}
