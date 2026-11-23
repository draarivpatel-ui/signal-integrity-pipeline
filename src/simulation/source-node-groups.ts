import { findConnectedNetworks } from "circuit-json-to-connectivity-map"
import {
  type CircuitJsonDb,
  type CopperScope,
  type SourceNetId,
  type SourcePortId,
  type SourceTraceId,
  sourcePinTies,
} from "../board"
import type { Snapshot } from "../kernel"
import {
  type ConnectionGraph,
  connectionGraph,
  connectionPath,
} from "./connection-paths"
import {
  type CutConnection,
  cutConnections,
  physicalCutGraph,
  validateCutBridge,
} from "./cut-connections"
import { fail } from "./diagnostics"
import type { RoutedTraceCut } from "./routed-types"

/** Source IDs which may resolve to a SPICE node. */
export type SourceNodeId = SourcePortId | SourceNetId

/** Each source port or net's representative under ideal connectivity. */
export type SourceNodeGroups = ReadonlyMap<SourceNodeId, SourceNodeId>

/** Each given node's representative under the specified connections. */
export type NodeGroups<NodeId> = ReadonlyMap<NodeId, NodeId>

/** Use the shared disjoint sets to give every group a representative. */
export function nodeGroups<NodeId extends string>(
  connections: NodeId[][],
): NodeGroups<NodeId> {
  const networks = Object.values(
    findConnectedNetworks(connections),
  ) as NodeId[][]
  return new Map(
    networks.flatMap((members) =>
      members.map((id) => [id, members[0]] as const),
    ),
  )
}

type SourceTrace = ReturnType<CircuitJsonDb["source_trace"]["list"]>[number]

/** Resolve a source contact to its group, retaining the contact when it is isolated. */
export function sourceGroupId({
  groups,
  sourcePortId,
}: {
  groups: SourceNodeGroups
  sourcePortId: SourcePortId
}): SourceNodeId {
  return groups.get(sourcePortId) ?? sourcePortId
}

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
  const cutGraph = connectionGraph(
    cutConnections({
      cuts,
      node: (sourcePortId) =>
        sourceGroupId({ groups: explicitGroups, sourcePortId }),
    }),
  )
  const physicalGraph = physicalCutGraph(cuts)
  const netGroups = nodeGroups(
    ideal
      .filter((trace) => !trace.connected_source_port_ids.length)
      .map((trace) => [...(trace.connected_source_net_ids ?? [])]),
  )
  const portsByNet = new Map<SourceNetId, Set<SourceNodeId>>()
  for (const trace of ideal) {
    const [sourcePortId] = trace.connected_source_port_ids
    if (trace.connected_source_port_ids.length !== 1) continue
    const contact = sourceGroupId({ groups: explicitGroups, sourcePortId })
    for (const sourceNetId of trace.connected_source_net_ids ?? []) {
      const net = netGroups.get(sourceNetId) ?? sourceNetId
      const contacts = portsByNet.get(net) ?? new Set<SourceNodeId>()
      contacts.add(contact)
      portsByNet.set(net, contacts)
    }
  }
  const splitNets = new Set<SourceNetId>()
  for (const [net, contacts] of portsByNet) {
    const namedCuts = connectingCuts({ cutGraph, contacts, physicalGraph })
    if (!namedCuts.length) continue
    const ids = new Set([
      net,
      ...[...netGroups].flatMap(([id, group]) => {
        if (group === net) return [id]
        return []
      }),
    ])
    validateSplitNet({ db, ids, cuts: namedCuts, explicitGroups })
    for (const id of ids) splitNets.add(id)
  }
  return splitNets
}

/** Select only the cuts needed to connect the net's attachments. */
function connectingCuts({
  cutGraph,
  contacts,
  physicalGraph,
}: {
  physicalGraph: ReturnType<typeof physicalCutGraph>
  cutGraph: ConnectionGraph<SourceNodeId, RoutedTraceCut>
  contacts: ReadonlySet<SourceNodeId>
}): CutConnection<SourceNodeId>[] {
  const unattached = new Set(contacts)
  const cuts = new Set<CutConnection<SourceNodeId>>()
  for (const fromNodeId of unattached) {
    unattached.delete(fromNodeId)
    for (const toNodeId of unattached) {
      const path = connectionPath({ graph: cutGraph, fromNodeId, toNodeId })
      if (!path) continue
      unattached.delete(toNodeId)
      for (const connection of path) cuts.add(connection)
    }
  }
  for (const connection of cuts)
    validateCutBridge({ graph: cutGraph, connection, physicalGraph })
  return [...cuts]
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
  cuts: readonly CutConnection<SourceNodeId>[]
  explicitGroups: SourceNodeGroups
}): void {
  const [{ evidence: cut }] = cuts
  if (
    db.source_net
      .list()
      .some((net) => ids.has(net.source_net_id) && net.is_ground)
  )
    shortedCut({ cut, reason: "are bound to ground" })
  const degrees = new Map<SourceNodeId, number>()
  const pairs = cuts.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])
  for (const sourceNodeId of pairs.flat())
    degrees.set(sourceNodeId, (degrees.get(sourceNodeId) ?? 0) + 1)
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
export interface IdealSourceNodes {
  groups: SourceNodeGroups
  splitNets: ReadonlySet<SourceNetId>
}

/** Find all extracted nonrail traces using the same copper scope in admission and binding. */
export function extractedNonrailSourceTraceIds({
  db,
  copperScope,
}: {
  db: CircuitJsonDb
  copperScope: Pick<
    Snapshot<CopperScope>,
    "extractedPcbTraceIds" | "nearbyRailPcbTraceIds"
  >
}): SourceTraceId[] {
  const extractedPcbTraceIds = new Set(copperScope.extractedPcbTraceIds)
  const nearbyRailPcbTraceIds = new Set(copperScope.nearbyRailPcbTraceIds)
  return db.pcb_trace
    .list()
    .flatMap(({ pcb_trace_id: pcbTraceId, source_trace_id: sourceTraceId }) => {
      if (
        sourceTraceId === undefined ||
        !extractedPcbTraceIds.has(pcbTraceId) ||
        nearbyRailPcbTraceIds.has(pcbTraceId)
      )
        return []
      return [sourceTraceId]
    })
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
  const pinTies = sourcePinTies(db)
  const explicitGroups = nodeGroups([
    ...ideal.map((trace) => [...trace.connected_source_port_ids]),
    ...pinTies,
  ])
  const splitNets = splitNamedNets({ db, cuts, ideal, explicitGroups })
  const groups = nodeGroups([
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
