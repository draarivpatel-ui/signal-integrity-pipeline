import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { SourceTrace } from "circuit-json"
import { findConnectedNetworks } from "circuit-json-to-connectivity-map"
import { type SourceNetId, type SourcePortId, sourcePinTies } from "../board"
import {
  type ConnectionGraph,
  connectionGraph,
  connectionPath,
  findConnectionBridges,
} from "./connection-paths"
import { fail } from "./diagnostics"
import type { TraceContacts } from "./route-inputs"
import {
  buildPhysicalTraceGraph,
  connectTraces,
  type TraceConnection,
  validateChannelBridge,
} from "./trace-connections"

/** Source IDs which may resolve to a SPICE node. */
export type SourceContactId = SourcePortId | SourceNetId

/** Each source port or net's representative under ideal connectivity. */
export type IdealGroups = ReadonlyMap<SourceContactId, SourceContactId>

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

/** Resolve a source contact to its group, retaining the contact when it is isolated. */
export function getIdealGroupId({
  groups,
  sourcePortId,
}: {
  groups: IdealGroups
  sourcePortId: SourcePortId
}): SourceContactId {
  return groups.get(sourcePortId) ?? sourcePortId
}

/** Report a cut whose contacts connect without the extracted trace. */
export function failShortedTrace({
  cut,
  reason,
}: {
  cut: TraceContacts
  reason: string
}): never {
  return fail(
    "channel_short",
    `${cut.sourceTraceId}: ${cut.fromSourcePortId} and ${cut.toSourcePortId} ${reason}`,
    {
      subjects: [
        cut.sourceTraceId,
        cut.fromSourcePortId,
        cut.toSourcePortId,
      ].map((id) => ({ kind: "record", id })),
    },
  )
}

/** Net identifiers spanning distinct extracted trace contacts. */
type SplitSourceNetIds = ReadonlySet<SourceNetId>

/** Identify the redundant net labels on a linear routed path. */
function splitNamedNets({
  db,
  ideal,
  explicitGroups,
  cuts,
}: {
  db: CircuitJsonUtilObjects
  ideal: readonly SourceTrace[]
  explicitGroups: IdealGroups
  cuts: readonly TraceContacts[]
}): SplitSourceNetIds {
  const cutConnectionsByGroup = connectTraces({
    cuts,
    node: (sourcePortId) =>
      getIdealGroupId({ groups: explicitGroups, sourcePortId }),
  })
  const cutGraph = connectionGraph(cutConnectionsByGroup)
  const bridges = findConnectionBridges(cutGraph)
  const cutNetworks = nodeGroups(
    cutConnectionsByGroup.map(({ fromVertexId, toVertexId }) => [
      fromVertexId,
      toVertexId,
    ]),
  )
  const physicalGraph = buildPhysicalTraceGraph(cuts)
  const netGroups = nodeGroups(
    ideal
      .filter((trace) => !trace.connected_source_port_ids.length)
      .map((trace) => [...(trace.connected_source_net_ids ?? [])]),
  )
  const portsByNet = new Map<SourceNetId, Set<SourceContactId>>()
  for (const trace of ideal) {
    const [sourcePortId] = trace.connected_source_port_ids
    if (sourcePortId === undefined) continue
    const contact = getIdealGroupId({ groups: explicitGroups, sourcePortId })
    if (!cutNetworks.has(contact)) continue
    for (const sourceNetId of trace.connected_source_net_ids ?? []) {
      const net = netGroups.get(sourceNetId) ?? sourceNetId
      const contacts = portsByNet.get(net) ?? new Set<SourceContactId>()
      contacts.add(contact)
      portsByNet.set(net, contacts)
    }
  }
  const splitNets = new Set<SourceNetId>()
  for (const [net, contacts] of portsByNet) {
    const namedCuts = connectingCuts({ cutGraph, cutNetworks, contacts })
    const connection = namedCuts.find((edge) => !bridges.has(edge))
    if (connection)
      validateChannelBridge({ graph: cutGraph, connection, physicalGraph })
    if (!namedCuts.length) continue
    const sourceNetIds = new Set([
      net,
      ...[...netGroups].flatMap(([id, group]) => {
        if (group === net) return [id]
        return []
      }),
    ])
    validateSplitNet({ db, sourceNetIds, cuts: namedCuts, explicitGroups })
    for (const id of sourceNetIds) splitNets.add(id)
  }
  return splitNets
}

/** Select only the cuts needed to connect the net's attachments. */
function connectingCuts({
  cutGraph,
  contacts,
  cutNetworks,
}: {
  cutNetworks: IdealGroups
  cutGraph: ConnectionGraph<SourceContactId, TraceContacts>
  contacts: ReadonlySet<SourceContactId>
}): TraceConnection<SourceContactId>[] {
  const contactsByCutNetwork = new Map<SourceContactId, SourceContactId>()
  const cuts = new Set<TraceConnection<SourceContactId>>()
  for (const toVertexId of contacts) {
    const cutNetworkId = cutNetworks.get(toVertexId)!
    const fromVertexId = contactsByCutNetwork.get(cutNetworkId)
    if (fromVertexId === undefined) {
      contactsByCutNetwork.set(cutNetworkId, toVertexId)
      continue
    }
    for (const connection of connectionPath({
      graph: cutGraph,
      fromVertexId,
      toVertexId,
    })!)
      cuts.add(connection)
  }
  return [...cuts]
}

/** Require every binding of a split net to refer to the same linear routed path. */
function validateSplitNet({
  db,
  sourceNetIds,
  cuts,
  explicitGroups,
}: {
  db: CircuitJsonUtilObjects
  sourceNetIds: SplitSourceNetIds
  cuts: readonly TraceConnection<SourceContactId>[]
  explicitGroups: IdealGroups
}): void {
  const [{ evidence: cut }] = cuts
  if (
    db.source_net
      .list()
      .some((net) => sourceNetIds.has(net.source_net_id) && net.is_ground)
  )
    failShortedTrace({ cut, reason: "are bound to ground" })
  const degrees = new Map<SourceContactId, number>()
  const pairs = cuts.map(({ fromVertexId, toVertexId }) => [
    fromVertexId,
    toVertexId,
  ])
  for (const sourceNodeId of pairs.flat())
    degrees.set(sourceNodeId, (degrees.get(sourceNodeId) ?? 0) + 1)
  const attached = db.source_trace
    .list()
    .filter((trace) =>
      trace.connected_source_net_ids?.some((id) => sourceNetIds.has(id)),
    )
  for (const trace of attached) {
    const nets = trace.connected_source_net_ids ?? []
    if (
      nets.some((id) => !sourceNetIds.has(id)) ||
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
export interface IdealConnectivity {
  groups: IdealGroups
  splitNets: ReadonlySet<SourceNetId>
  wireConnections: SourceContactId[][]
}

/** Join source traces and internal pin ties, with routed copper removed. */
export function resolveIdealConnectivity({
  db,
  cuts,
}: {
  db: CircuitJsonUtilObjects
  cuts: readonly TraceContacts[]
}): IdealConnectivity {
  const extracted = new Set(cuts.map((cut) => cut.sourceTraceId))
  const ideal = db.source_trace
    .list()
    .filter((trace) => !extracted.has(trace.source_trace_id))
  const pinTies = sourcePinTies(db)
  const explicitGroups = nodeGroups([
    ...ideal.map((trace) => [...trace.connected_source_port_ids]),
    ...pinTies,
  ])
  const splitNets = splitNamedNets({ db, cuts, ideal, explicitGroups })
  const wireConnections = [
    ...ideal.map((trace) => [
      ...trace.connected_source_port_ids,
      ...(trace.connected_source_net_ids ?? []).filter(
        (id) => !splitNets.has(id),
      ),
    ]),
    ...pinTies,
  ]
  return { groups: nodeGroups(wireConnections), splitNets, wireConnections }
}
