import { hypotenuse, type Snapshot } from "../kernel"
import type { CopperPoint } from "./geometry/types"
import type { RouteWire, UnitDirection } from "./route-section-types"

/** Ignore zero-length copper and section boundaries already at a wire end. */
export const MIN_WIRE_LENGTH_MM = 1e-7
/** Coordinate precision in mm and component precision for direction grouping. */
const ROUTE_DECIMAL_PLACES = 7
/** Near-vertical wires have a canonical direction pointing up. */
const DIRECTION_TOLERANCE = 1e-9

/** Round longitudinal positions and direction components on the same grid. */
export function roundRouteCoordinate(coordinate: number): number {
  return Number(coordinate.toFixed(ROUTE_DECIMAL_PLACES))
}

/** A rounded direction used to group parallel wires. */
export type DirectionKey = string

/** Write rounded components as numbers so signed zeros share a key. */
export function getDirectionKey(
  direction: Snapshot<UnitDirection>,
): DirectionKey {
  return direction.map(roundRouteCoordinate).join(",")
}

/** Shortest distance from a point to a finite wire or a lone endpoint. */
export function measureChordDistanceMm({
  point,
  startPoint,
  endPoint,
}: {
  point: Snapshot<CopperPoint>
  startPoint: Snapshot<CopperPoint>
  endPoint: Snapshot<CopperPoint>
}): number {
  const dx = endPoint[0] - startPoint[0]
  const dy = endPoint[1] - startPoint[1]
  const lengthSquaredMm = dx * dx + dy * dy
  const offsetX = point[0] - startPoint[0]
  const offsetY = point[1] - startPoint[1]
  if (lengthSquaredMm === 0) return hypotenuse(offsetX, offsetY)
  const fraction = Math.max(
    0,
    Math.min(1, (offsetX * dx + offsetY * dy) / lengthSquaredMm),
  )
  return hypotenuse(offsetX - fraction * dx, offsetY - fraction * dy)
}

/** Canonical direction and projected coordinates for a straight wire. */
type WireProjection = Pick<
  RouteWire,
  "direction" | "startMm" | "endMm" | "lateralOffsetMm"
>

/** Project physical endpoints onto canonical longitudinal and lateral axes. */
export function projectRouteWire({
  startPoint,
  endPoint,
  lengthMm,
}: {
  startPoint: CopperPoint
  endPoint: CopperPoint
  lengthMm: number
}): WireProjection {
  const dx = endPoint[0] - startPoint[0]
  const dy = endPoint[1] - startPoint[1]
  const directionX = dx / lengthMm
  let sign = 1
  if (
    directionX < -DIRECTION_TOLERANCE ||
    (Math.abs(directionX) <= DIRECTION_TOLERANCE && dy < 0)
  )
    sign = -1
  const direction: UnitDirection = [
    (sign * dx) / lengthMm,
    (sign * dy) / lengthMm,
  ]
  const startMm = startPoint[0] * direction[0] + startPoint[1] * direction[1]
  const endMm = endPoint[0] * direction[0] + endPoint[1] * direction[1]
  return {
    direction,
    startMm: Math.min(startMm, endMm),
    endMm: Math.max(startMm, endMm),
    lateralOffsetMm:
      -startPoint[0] * direction[1] + startPoint[1] * direction[0],
  }
}

/** Convert a longitudinal position to board coordinates on the wire centerline. */
export function getRoutePoint({
  wire,
  positionMm,
}: {
  wire: Snapshot<Pick<RouteWire, "direction" | "lateralOffsetMm">>
  positionMm: number
}): CopperPoint {
  const [x, y] = wire.direction
  return [
    x * positionMm - y * wire.lateralOffsetMm,
    y * positionMm + x * wire.lateralOffsetMm,
  ]
}

/** Partition laterally ordered wire intervals, tracking each group's full extent. */
export function groupWiresByGap({
  wires,
  gapMm,
}: {
  wires: readonly RouteWire[]
  gapMm: number
}): RouteWire[][] {
  const ordered = wires.toSorted(
    (a, b) =>
      a.lateralOffsetMm - a.widthMm / 2 - (b.lateralOffsetMm - b.widthMm / 2) ||
      a.wireIndex - b.wireIndex,
  )
  const groups: RouteWire[][] = []
  let group: RouteWire[] = []
  let groupMaxMm = -Infinity
  for (const wire of ordered) {
    const minMm = wire.lateralOffsetMm - wire.widthMm / 2
    if (minMm - groupMaxMm > gapMm) {
      group = []
      groups.push(group)
      groupMaxMm = -Infinity
    }
    group.push(wire)
    groupMaxMm = Math.max(groupMaxMm, wire.lateralOffsetMm + wire.widthMm / 2)
  }
  return groups
}
