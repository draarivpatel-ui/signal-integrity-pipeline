import {
  circuitJsonDb,
  type LaneMapping,
  type SourcePortId,
  type SourceTraceId,
} from "../board"
import {
  idealSourceNodes,
  type RoutedTraceCut,
  type SourceNodeGroups,
  sourceNodeGroups,
} from "../simulation"
import { fail } from "./diagnostics"
import { endpointPorts, type PreparedChannelSimulation } from "./signals"
import { crossesDifferentialLegs } from "./topology"

/** A physical cut between source groups, labelled with its extracted trace. */
interface RoutedEdge extends RoutedTraceCut {
  kind: "routed"
}

/** A path through a series component, which does not contribute a trace. */
interface SeriesEdge {
  kind: "series"
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
}

type ReceiverEdge = RoutedEdge | SeriesEdge

/** Incident routed and series edges indexed by electrical node. */
type ReceiverGraph = ReadonlyMap<SourcePortId, ReceiverEdge[]>

/** Index routed and series edges at both ends. */
function receiverGraph({
  edges,
  groups,
}: {
  edges: readonly ReceiverEdge[]
  groups: SourceNodeGroups
}): ReceiverGraph {
  const graph = new Map<SourcePortId, ReceiverEdge[]>()
  for (const edge of edges) {
    const from = groups.get(edge.fromSourcePortId) ?? edge.fromSourcePortId
    const to = groups.get(edge.toSourcePortId) ?? edge.toSourcePortId
    if (from === to) continue
    const joined = { ...edge, fromSourcePortId: from, toSourcePortId: to }
    for (const port of [from, to]) {
      const incident = graph.get(port)
      if (incident) incident.push(joined)
      else graph.set(port, [joined])
    }
  }
  return graph
}

/** Find the other node of an edge incident to this one. */
function otherNode({
  edge,
  port,
}: {
  edge: ReceiverEdge
  port: SourcePortId
}): SourcePortId {
  if (edge.fromSourcePortId === port) return edge.toSourcePortId
  return edge.fromSourcePortId
}

/** Ordered extracted trace IDs between two reachable nodes. */
type ReceiverTraceIds = SourceTraceId[]

/** Recover the ordered cut IDs from an already-validated connectivity graph. */
function receiverTraceIds({
  graph,
  from,
  to,
  excluded,
}: {
  graph: ReceiverGraph
  from: SourcePortId
  to: SourcePortId
  excluded?: ReceiverEdge
}): ReceiverTraceIds | undefined {
  const reached = new Map<SourcePortId, ReceiverEdge | null>([[from, null]])
  for (const [port] of reached) {
    if (port === to) {
      const traceIds: ReceiverTraceIds = []
      let current = port
      let edge = reached.get(current)
      while (edge) {
        if (edge.kind === "routed") traceIds.push(edge.sourceTraceId)
        current = otherNode({ edge, port: current })
        edge = reached.get(current)
      }
      return traceIds.reverse()
    }
    for (const edge of graph.get(port) ?? []) {
      if (edge === excluded) continue
      const next = otherNode({ edge, port })
      if (!reached.has(next)) reached.set(next, edge)
    }
  }
}

/** Retain evidence of a routed receiver path which an ideal bypass closes into a loop. */
function bypassedReceiverTraceIds({
  graph,
  port,
}: {
  graph: ReceiverGraph
  port: SourcePortId
}): ReceiverTraceIds {
  for (const edge of graph.get(port) ?? []) {
    const from = otherNode({ edge, port })
    const traceIds = receiverTraceIds({ graph, from, to: port, excluded: edge })
    if (!traceIds) continue
    if (edge.kind === "routed") return [edge.sourceTraceId, ...traceIds]
    if (traceIds.length) return traceIds
  }
  return []
}

/** Include series passives along a leg and leave differential terminations outside it. */
function receiverEdges({
  prepared,
  cuts,
  groups,
}: {
  prepared: PreparedChannelSimulation
  cuts: readonly RoutedTraceCut[]
  groups: SourceNodeGroups
}): ReceiverEdge[] {
  const legGroups = sourceNodeGroups([
    ...[...groups].map(([id, group]) => [id, group]),
    ...cuts.map(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
  ])
  const differential = prepared.driverReceiverChannels.flatMap(
    ({ driver, receivers }) => {
      if ("source_port_id" in driver) return []
      const endpoints = [
        driver,
        ...receivers.filter((end) => "p_source_port_id" in end),
      ]
      return [
        {
          positive: new Set(
            endpoints.map(
              (end) =>
                legGroups.get(end.p_source_port_id) ?? end.p_source_port_id,
            ),
          ),
          negative: new Set(
            endpoints.map(
              (end) =>
                legGroups.get(end.n_source_port_id) ?? end.n_source_port_id,
            ),
          ),
        },
      ]
    },
  )
  const edges: ReceiverEdge[] = cuts.map((cut) => ({ ...cut, kind: "routed" }))
  for (const [fromSourcePortId, toSourcePortId] of prepared.routedTopology
    .bridges) {
    if (
      crossesDifferentialLegs({
        from: legGroups.get(fromSourcePortId) ?? fromSourcePortId,
        to: legGroups.get(toSourcePortId) ?? toSourcePortId,
        differential,
      })
    )
      continue
    edges.push({ kind: "series", fromSourcePortId, toSourcePortId })
  }
  return edges
}

/** Resolve each declared receiver against the cut graph of ideal electrical groups. */
export function routedReceiverMappings({
  prepared,
  cuts,
}: {
  prepared: PreparedChannelSimulation
  cuts: readonly RoutedTraceCut[]
}): LaneMapping[] {
  const { groups } = idealSourceNodes({
    db: circuitJsonDb(prepared.circuit),
    cuts,
  })
  const edges = receiverEdges({ prepared, cuts, groups })
  const physical = receiverGraph({ edges, groups: new Map() })
  const graph = receiverGraph({ edges, groups })
  const mappings: LaneMapping[] = []
  for (const { name, driver, receivers } of prepared.driverReceiverChannels) {
    const driverPorts = endpointPorts(driver)
    for (const receiver of receivers) {
      for (const [leg, to] of endpointPorts(receiver).entries()) {
        const from = driverPorts[leg]
        const fromNode = groups.get(from) ?? from
        const toNode = groups.get(to) ?? to
        let traceIds = receiverTraceIds({ graph, from: fromNode, to: toNode })
        if (
          !prepared.channelSimulation.allow_unrouted_traces ||
          fromNode === toNode
        ) {
          traceIds = receiverTraceIds({ graph: physical, from, to })
          if (!traceIds && prepared.channelSimulation.allow_unrouted_traces)
            traceIds = bypassedReceiverTraceIds({ graph, port: fromNode })
        }
        if (!traceIds)
          return fail(
            "channel_net",
            `${name}: no source path from ${from} to ${to}`,
          )
        const [sourceTraceId] = traceIds
        if (sourceTraceId === undefined) continue
        const mapping = { port: name, from, to, sourceTraceId }
        if (traceIds.length > 1)
          mappings.push({ ...mapping, sourceTraceIds: traceIds })
        else mappings.push(mapping)
      }
    }
  }
  return mappings
}
