import { cju } from "@tscircuit/circuit-json-util"
import {
  type ConnectivityMap,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "./connectivity"
import type { SourceTraceId } from "./ids"
import type { RouteWire } from "./route-section-types"
import {
  getDirectionKey,
  getRoutePoint,
  groupWiresByGap,
  type WireGroup,
} from "./route-wire"
import type { CircuitJson, SourceTrace } from "./schema"

/** Require a positive shared length before merging parallel copper. */
const MIN_OVERLAP_LENGTH_MM = 1e-6
/** Geometry tolerance for touching edges, short intervals and coincident joins. */
const UNION_TOLERANCE_MM = 1e-7

type CopperGroupKey = string

/** Find the common root index without modifying the caller's array. */
function findRootIndex({
  index,
  parents,
}: {
  index: number
  parents: readonly number[]
}): number {
  while (parents[index] !== index) index = parents[index]
  return index
}

/** Direction of travel relative to the wire's canonical axis. */
function getWireOrientation(wire: RouteWire): number {
  const [x, y] = wire.direction
  const dx = wire.endPoint[0] - wire.startPoint[0]
  const dy = wire.endPoint[1] - wire.startPoint[1]
  if (dx * x + dy * y > 0) return 1
  return -1
}

/** A stable identifier shared by traces attached to the same electrical net. */
function getTraceNetKey({
  sourceTrace,
  connectivity,
}: {
  sourceTrace: SourceTrace
  connectivity: ConnectivityMap
}): string {
  const sourceMemberId =
    sourceTrace.connected_source_port_ids[0] ??
    sourceTrace.connected_source_net_ids?.[0]
  if (sourceMemberId === undefined) return sourceTrace.source_trace_id
  return [
    ...sourceNetMembers({ connectivity, memberId: sourceMemberId }),
  ].sort()[0]
}

/** Partition parallel wires by physical contact. */
function groupConnectedWires(wires: WireGroup): Iterable<WireGroup> {
  const parents = wires.map((_, index) => index)
  for (const [index, wire] of wires.entries()) {
    for (let otherIndex = index + 1; otherIndex < wires.length; otherIndex++) {
      const otherWire = wires[otherIndex]
      const overlapMm =
        Math.min(wire.longitudinalMaxMm, otherWire.longitudinalMaxMm) -
        Math.max(wire.longitudinalMinMm, otherWire.longitudinalMinMm)
      if (overlapMm <= MIN_OVERLAP_LENGTH_MM) continue
      const separationMm = Math.abs(
        wire.lateralOffsetMm - otherWire.lateralOffsetMm,
      )
      if (
        separationMm >
        (wire.widthMm + otherWire.widthMm) / 2 + UNION_TOLERANCE_MM
      )
        continue
      parents[findRootIndex({ index: otherIndex, parents })] = findRootIndex({
        index,
        parents,
      })
    }
  }
  const groups = new Map<number, WireGroup>()
  for (const [index, wire] of wires.entries()) {
    const rootIndex = findRootIndex({ index, parents })
    const group = groups.get(rootIndex)
    if (group) group.push(wire)
    else groups.set(rootIndex, [wire])
  }
  return groups.values()
}

/** Build the occupied rectangle and join the original wires to its centerline. */
function mergeWires({
  wires,
  longitudinalMinMm,
  longitudinalMaxMm,
}: Pick<RouteWire, "longitudinalMinMm" | "longitudinalMaxMm"> & {
  wires: WireGroup
}): RouteWire {
  const orderedWires = wires.toSorted((a, b) => a.wireIndex - b.wireIndex)
  const [firstWire] = orderedWires
  const minMm = Math.min(
    ...wires.map((wire) => wire.lateralOffsetMm - wire.widthMm / 2),
  )
  const maxMm = Math.max(
    ...wires.map((wire) => wire.lateralOffsetMm + wire.widthMm / 2),
  )
  const mergedWire = {
    ...firstWire,
    longitudinalMinMm,
    longitudinalMaxMm,
    widthMm: maxMm - minMm,
    lateralOffsetMm: (minMm + maxMm) / 2,
  }
  const positionsMm = [longitudinalMinMm, longitudinalMaxMm]
  if (getWireOrientation(firstWire) < 0) positionsMm.reverse()
  const [startPoint, endPoint] = positionsMm.map((positionMm) =>
    getRoutePoint({ wire: mergedWire, positionMm }),
  )
  const joins = orderedWires
    .filter(
      (wire) =>
        Math.abs(wire.lateralOffsetMm - mergedWire.lateralOffsetMm) >
        UNION_TOLERANCE_MM,
    )
    .flatMap((wire) =>
      [longitudinalMinMm, longitudinalMaxMm].map((positionMm) => ({
        sourceTraceId: wire.sourceTraceId,
        pcbTraceId: wire.pcbTraceId,
        fromPoint: getRoutePoint({ wire, positionMm }),
        toPoint: getRoutePoint({ wire: mergedWire, positionMm }),
      })),
    )
  const merged: RouteWire = { ...mergedWire, startPoint, endPoint, joins }
  const contributingPcbTraceIds = [
    ...new Set(orderedWires.map(({ pcbTraceId }) => pcbTraceId)),
  ]
  if (contributingPcbTraceIds.length > 1)
    merged.contributingPcbTraceIds = contributingPcbTraceIds
  return merged
}

/** Partition connected wires at the ends of each copper overlap. */
function unionWireGroup(wires: WireGroup): RouteWire[] {
  if (wires.length === 1) return wires
  const boundariesMm = [
    ...new Set(
      wires.flatMap(({ longitudinalMinMm, longitudinalMaxMm }) => [
        longitudinalMinMm,
        longitudinalMaxMm,
      ]),
    ),
  ].sort((a, b) => a - b)
  const mergedWires: RouteWire[] = []
  for (let index = 1; index < boundariesMm.length; index++) {
    const longitudinalMinMm = boundariesMm[index - 1]
    const longitudinalMaxMm = boundariesMm[index]
    if (longitudinalMaxMm - longitudinalMinMm < UNION_TOLERANCE_MM) continue
    const midpointMm = (longitudinalMinMm + longitudinalMaxMm) / 2
    const active = wires.filter(
      (wire) =>
        wire.longitudinalMinMm < midpointMm &&
        wire.longitudinalMaxMm > midpointMm,
    )
    for (const group of groupWiresByGap({
      wires: active,
      gapMm: UNION_TOLERANCE_MM,
    }))
      mergedWires.push(
        mergeWires({ wires: group, longitudinalMinMm, longitudinalMaxMm }),
      )
  }
  return mergedWires
}

/** Union touching, parallel same-net conductors and keep their lateral joins. */
export function unionRouteWires({
  wires,
  circuit,
}: {
  wires: RouteWire[]
  circuit: CircuitJson
}): RouteWire[] {
  const db = cju([...circuit])
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const netKeys = new Map<SourceTraceId, string>()
  const groups = new Map<CopperGroupKey, RouteWire[]>()
  for (const wire of wires) {
    let netKey = netKeys.get(wire.sourceTraceId)
    if (netKey === undefined) {
      const sourceTrace = db.source_trace.get(wire.sourceTraceId)
      if (!sourceTrace)
        throw new Error(
          `${wire.pcbTraceId}: missing source trace ${wire.sourceTraceId}`,
        )
      netKey = getTraceNetKey({ sourceTrace, connectivity })
      netKeys.set(wire.sourceTraceId, netKey)
    }
    const key = JSON.stringify([
      netKey,
      wire.layer,
      getDirectionKey(wire.direction),
    ])
    const group = groups.get(key)
    if (group) group.push(wire)
    else groups.set(key, [wire])
  }
  const mergedWires = [...groups.values()].flatMap((group) =>
    [...groupConnectedWires(group)].flatMap(unionWireGroup),
  )
  mergedWires.sort((a, b) => {
    if (a.wireIndex !== b.wireIndex) return a.wireIndex - b.wireIndex
    return (
      getWireOrientation(wires[a.wireIndex]) *
      (a.longitudinalMinMm - b.longitudinalMinMm)
    )
  })
  return mergedWires.map((wire, wireIndex) => ({ ...wire, wireIndex }))
}
