import type { PolygonEdge } from "@flatten-js/core"
import { getPourPolygon } from "@tscircuit/circuit-json-util"
import type { PcbCopperPour } from "circuit-json"
import { hypotenuse, type Snapshot } from "../kernel"
import { polygonContains } from "./geometry/polygon"
import type { CopperPoint } from "./geometry/types"
import type {
  ReferencePour,
  RouteReference,
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
      2 * Math.acos(Math.max(-1, 1 - POUR_CHORD_TOLERANCE_MM / arc.r))
    const steps = Math.max(1, Math.ceil(arc.sweep / maxAngle))
    const points: CopperPoint[] = [[arc.start.x, arc.start.y]]
    for (let index = 1; index < steps; index++) {
      const point = arc.pointAtLength((index * arc.length) / steps)
      if (point) points.push([point.x, point.y])
    }
    return points
  })
}

/** Normalize all Circuit JSON pour encodings using the same geometry as copper scope. */
export function normalizeReferencePour(pour: PcbCopperPour): ReferencePour[] {
  if (pour.source_net_id === undefined) return []
  const outline = getPourPolygon(pour)
  return [
    {
      pcbCopperPourId: pour.pcb_copper_pour_id,
      sourceNetId: pour.source_net_id,
      layer: pour.layer,
      polygon: [...outline.faces].map((face) =>
        face.edges.flatMap(samplePourEdge),
      ),
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
  pour: Snapshot<ReferencePour>
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
  pour: Snapshot<ReferencePour>
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
  pour: Snapshot<ReferencePour>
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

/** Find the nearest reference edge when the centerline crosses no reference copper. */
function findEdgeReference({
  point,
  surfaces,
  signal,
}: {
  point: CopperPoint
  surfaces: ReferenceSurface[]
  signal: Snapshot<CopperLayer>
}): RouteReference[] {
  let nearest: ReferenceCandidate | undefined
  for (const { reference, pour, verticalGapMm, isAboveSignal } of surfaces) {
    const lateralGapMm = measurePourGapMm({ point, pour })
    const distanceMm = hypotenuse(verticalGapMm, lateralGapMm)
    if (distanceMm >= MAX_REFERENCE_EDGE_DISTANCE_MM) continue
    if (nearest && nearest.distanceMm <= distanceMm) continue
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
}: {
  geometry: Snapshot<Pick<SectionGeometry, "stackup" | "pours">>
  wire: Snapshot<RouteWire>
  positionMm: number
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
  return findEdgeReference({ point, surfaces, signal })
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
