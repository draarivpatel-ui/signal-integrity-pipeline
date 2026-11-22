import { findConnectedNetworks } from "circuit-json-to-connectivity-map"
import type {
  CircuitJsonDb,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "../board"
import { fail } from "./diagnostics"
import type { RoutedTraceCut } from "./routed-types"

/** Source IDs which may resolve to a SPICE node. */
type SourceNodeId = SourcePortId | SourceNetId

/** Each source port or net's representative under ideal connectivity. */
export type SourceNodeGroups = ReadonlyMap<SourceNodeId, SourceNodeId>

/** Use the shared disjoint sets to give every group a representative. */
export function sourceNodeGroups(
  connections: SourceNodeId[][],
): SourceNodeGroups {
  return new Map(
    Object.values(findConnectedNetworks(connections)).flatMap((members) =>
      members.map((id) => [id, members[0]] as const),
    ),
  )
}

type SourceTrace = ReturnType<CircuitJsonDb["source_trace"]["list"]>[number]

/** Report a cut whose contacts connect without the extracted trace. */
export function shortedCut({
  cut,
  reason,
}: {
  cut: RoutedTraceCut
  reason: string
}): never {
  return fail(
    "channel_short",
    `${cut.sourceTraceId}: ${cut.fromSourcePortId} and ${cut.toSourcePortId} ${reason}`,
  )
}

/** Identify the redundant net labels on a linear routed path. */
function splitNamedNets({
  db,
  ideal,
  explicitGroups,
  cuts,
}: {
  db: CircuitJsonDb
  ideal: readonly SourceTrace[]
  explicitGroups: SourceNodeGroups
  cuts: readonly RoutedTraceCut[]
}): ReadonlySet<SourceNetId> {
  const cutsByNet = new Map<SourceNetId, RoutedTraceCut[]>()
  const netGroups = sourceNodeGroups(
    ideal
      .filter((trace) => !trace.connected_source_port_ids.length)
      .map((trace) => [...(trace.connected_source_net_ids ?? [])]),
  )
  const netsByPort = new Map<SourcePortId, Set<SourceNetId>>()
  for (const trace of ideal) {
    const ports = trace.connected_source_port_ids
    if (ports.length !== 1) continue
    const port = explicitGroups.get(ports[0]) ?? ports[0]
    const nets = netsByPort.get(port) ?? new Set<SourceNetId>()
    for (const id of trace.connected_source_net_ids ?? [])
      nets.add(netGroups.get(id) ?? id)
    netsByPort.set(port, nets)
  }
  for (const cut of cuts) {
    const from =
      explicitGroups.get(cut.fromSourcePortId) ?? cut.fromSourcePortId
    const to = explicitGroups.get(cut.toSourcePortId) ?? cut.toSourcePortId
    // An explicit short still survives when the redundant labels are removed.
    if (from === to) continue
    for (const net of netsByPort.get(from) ?? []) {
      if (netsByPort.get(to)?.has(net))
        cutsByNet.set(net, [...(cutsByNet.get(net) ?? []), cut])
    }
  }
  const splitNets = new Set<SourceNetId>()
  for (const [net, cuts] of cutsByNet) {
    const ids = new Set([
      net,
      ...[...netGroups].flatMap(([id, group]) => {
        if (group === net) return [id]
        return []
      }),
    ])
    validateSplitNet({ db, ids, cuts, explicitGroups })
    for (const id of ids) splitNets.add(id)
  }
  return splitNets
}

/** Require every binding of a split net to refer to the same linear routed path. */
function validateSplitNet({
  db,
  ids,
  cuts,
  explicitGroups,
}: {
  db: CircuitJsonDb
  ids: ReadonlySet<SourceNetId>
  cuts: readonly RoutedTraceCut[]
  explicitGroups: SourceNodeGroups
}): void {
  const [cut] = cuts
  if (
    db.source_net
      .list()
      .some((net) => ids.has(net.source_net_id) && net.is_ground)
  )
    shortedCut({ cut, reason: "are bound to ground" })
  const degrees = new Map<SourcePortId, number>()
  const pairs = cuts.map(({ fromSourcePortId, toSourcePortId }) => [
    explicitGroups.get(fromSourcePortId) ?? fromSourcePortId,
    explicitGroups.get(toSourcePortId) ?? toSourcePortId,
  ])
  for (const port of pairs.flat())
    degrees.set(port, (degrees.get(port) ?? 0) + 1)
  const attached = db.source_trace
    .list()
    .filter((trace) =>
      trace.connected_source_net_ids?.some((id) => ids.has(id)),
    )
  for (const trace of attached) {
    const nets = trace.connected_source_net_ids ?? []
    if (
      nets.some((id) => !ids.has(id)) ||
      (trace.connected_source_port_ids.length > 0 && nets.length !== 1)
    )
      fail(
        "channel_net",
        `${cut.sourceTraceId}: shared channel net has additional net bindings; select explicit endpoints`,
      )
  }
  if (
    Object.keys(findConnectedNetworks(pairs)).length !== 1 ||
    pairs.length !== degrees.size - 1 ||
    [...degrees.values()].some((degree) => degree > 2) ||
    attached.some((trace) =>
      trace.connected_source_port_ids.some(
        (id) => !degrees.has(explicitGroups.get(id) ?? id),
      ),
    )
  )
    fail(
      "channel_fanout",
      `${cut.sourceTraceId}: shared channel net has additional ports; bind loads to an explicit endpoint`,
    )
}

/** The ideal partition and the named nets which now span multiple nodes. */
interface IdealSourceNodes {
  groups: SourceNodeGroups
  splitNets: ReadonlySet<SourceNetId>
}

/** Join source traces and internal pin ties, with routed copper removed. */
export function idealSourceNodes({
  db,
  cuts,
  additionalSourceTraceIds = [],
}: {
  db: CircuitJsonDb
  cuts: readonly RoutedTraceCut[]
  additionalSourceTraceIds?: readonly SourceTraceId[]
}): IdealSourceNodes {
  const extracted = new Set([
    ...cuts.map((cut) => cut.sourceTraceId),
    ...additionalSourceTraceIds,
  ])
  const ideal = db.source_trace
    .list()
    .filter((trace) => !extracted.has(trace.source_trace_id))
  const pinTies = [
    ...db.source_component
      .list()
      .flatMap((component) =>
        (component.internally_connected_source_port_ids ?? []).map((ports) => [
          ...ports,
        ]),
      ),
    ...db.source_component_internal_connection
      .list()
      .map((connection) => [...connection.source_port_ids]),
  ]
  const explicitGroups = sourceNodeGroups([
    ...ideal.map((trace) => [...trace.connected_source_port_ids]),
    ...pinTies,
  ])
  const splitNets = splitNamedNets({ db, cuts, ideal, explicitGroups })
  const groups = sourceNodeGroups([
    ...ideal.map((trace) => [
      ...trace.connected_source_port_ids,
      ...(trace.connected_source_net_ids ?? []).filter(
        (id) => !splitNets.has(id),
      ),
    ]),
    ...pinTies,
  ])
  return { groups, splitNets }
}
