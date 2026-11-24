import { Line, Point, Vector } from "@flatten-js/core"
import { getTraceSegmentPolygon } from "@tscircuit/circuit-json-util"
import type { Snapshot } from "../kernel"
import type { CopperPoint } from "./geometry/types"
import type {
  ReferencePour,
  RouteSection,
  RouteWire,
} from "./route-section-types"
import { getRoutePoint, measureChordDistanceMm } from "./route-wire"

/** Limit edge references to the local neighborhood of ordinary board thicknesses. */
export const MAX_REFERENCE_EDGE_DISTANCE_MM = 2

/** The distance from the wire centerline to the copper outline, including holes. */
export function measurePourGapMm({
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

/** An interval along a section's canonical longitudinal axis, in millimetres. */
export type LongitudinalInterval = Pick<RouteSection, "startMm" | "endMm">

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
  startPoint: Snapshot<CopperPoint>
  endPoint: Snapshot<CopperPoint>
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
export function coversReferenceInterval({
  interval,
  wire,
  pour,
  verticalGapMm,
}: {
  interval: LongitudinalInterval
  wire: Snapshot<RouteWire>
  pour: Snapshot<ReferencePour>
  verticalGapMm: number
}): boolean {
  const lateralLimitMm = Math.sqrt(
    MAX_REFERENCE_EDGE_DISTANCE_MM ** 2 - verticalGapMm ** 2,
  )
  const start = getRoutePoint({ wire, positionMm: interval.startMm })
  const end = getRoutePoint({ wire, positionMm: interval.endMm })
  if (
    measurePourGapMm({ point: start, pour }) >= lateralLimitMm ||
    measurePourGapMm({ point: end, pour }) >= lateralLimitMm
  )
    return false

  const [x, y] = wire.direction
  const line = new Line(new Point(...start), new Vector(-y, x))
  const spans = pour.polygon
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
