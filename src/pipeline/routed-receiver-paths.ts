import {
  circuitJsonDb,
  type LaneMapping,
  type SourcePortId,
  type SourceTraceId,
} from "../board"
import {
  cutSourceGroups,
  differentialContacts,
  differentialGroups,
  idealSourceNodes,
  type RoutedTraceCut,
  type SourceNodeGroups,
  sourceGroupId,
  sourceNodeGroups,
} from "../simulation"
import { fail } from "./diagnostics"
import { endpointPorts, type PreparedChannelSimulation } from "./signals"
import { crossesDifferentialLegs } from "./topology"

/** A connection whose physical contacts are separated by extracted copper. */
interface RoutedEdge extends RoutedTraceCut {
  kind: "routed"
}

/** A connection through a series component, which contributes no trace. */
interface SeriesEdge {
  kind: "series"
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
}

/** An edge indexed by its electrical groups while retaining its physical contacts. */
interface ReceiverConnection {
  fromSourceGroupId: SourcePortId
  toSourceGroupId: SourcePortId
  edge: RoutedEdge | SeriesEdge
}

/** Incident routed and series connections indexed by source group. */
type ReceiverGraph = ReadonlyMap<SourcePortId, ReceiverConnection[]>

/** Index each connection at both ends, excluding already-collapsed edges. */
function receiverGraph({
  connections,
  groups,
}: {
  connections: readonly (RoutedEdge | SeriesEdge)[]
  groups?: SourceNodeGroups
}): ReceiverGraph {
  const graph = new Map<SourcePortId, ReceiverConnection[]>()
  for (const edge of connections) {
    let fromSourceGroupId = edge.fromSourcePortId
    let toSourceGroupId = edge.toSourcePortId
    if (groups) {
      fromSourceGroupId = sourceGroupId({
        groups,
        sourcePortId: edge.fromSourcePortId,
      })
      toSourceGroupId = sourceGroupId({
        groups,
        sourcePortId: edge.toSourcePortId,
      })
    }
    if (fromSourceGroupId === toSourceGroupId) continue
    const connection = { fromSourceGroupId, toSourceGroupId, edge }
    for (const sourceGroupId of [fromSourceGroupId, toSourceGroupId]) {
      const incident = graph.get(sourceGroupId)
      if (incident) incident.push(connection)
      else graph.set(sourceGroupId, [connection])
    }
  }
  return graph
}

/** Read the group at the opposite end of an incident connection. */
function oppositeSourceGroupId({
  connection,
  sourceGroupId,
}: {
  connection: ReceiverConnection
  sourceGroupId: SourcePortId
}): SourcePortId {
  if (connection.fromSourceGroupId === sourceGroupId)
    return connection.toSourceGroupId
  return connection.fromSourceGroupId
}

/** Extracted trace IDs in a receiver path's traversal order. */
type ReceiverTraceIds = SourceTraceId[]

/** Follow the shortest connected path through the routed cuts and series passives. */
function receiverTraceIds({
  graph,
  fromSourceGroupId,
  toSourceGroupId,
}: {
  graph: ReceiverGraph
  fromSourceGroupId: SourcePortId
  toSourceGroupId: SourcePortId
}): ReceiverTraceIds | undefined {
  const reached = new Map<SourcePortId, ReceiverConnection | null>([
    [fromSourceGroupId, null],
  ])
  for (const [sourceGroupId] of reached) {
    if (sourceGroupId === toSourceGroupId) {
      const traceIds: ReceiverTraceIds = []
      let currentSourceGroupId = sourceGroupId
      let connection = reached.get(currentSourceGroupId)
      while (connection) {
        if (connection.edge.kind === "routed")
          traceIds.push(connection.edge.sourceTraceId)
        currentSourceGroupId = oppositeSourceGroupId({
          connection,
          sourceGroupId: currentSourceGroupId,
        })
        connection = reached.get(currentSourceGroupId)
      }
      return traceIds.reverse()
    }
    for (const connection of graph.get(sourceGroupId) ?? []) {
      const nextSourceGroupId = oppositeSourceGroupId({
        connection,
        sourceGroupId,
      })
      if (!reached.has(nextSourceGroupId))
        reached.set(nextSourceGroupId, connection)
    }
  }
}

/** The depth-first state for finding cycles through a collapsed receiver contact. */
interface ReceiverCycleSearch {
  graph: ReceiverGraph
  rootSourceGroupId: SourcePortId
  sourceGroupOrder: Map<SourcePortId, number>
  openConnections: ReceiverConnection[]
  routedCycleTraceIds: ReceiverTraceIds
}

/** Close each biconnected component and keep its routed evidence when it contains the root. */
function visitReceiverCycles({
  search,
  sourceGroupId,
  parentConnection,
}: {
  search: ReceiverCycleSearch
  sourceGroupId: SourcePortId
  parentConnection?: ReceiverConnection
}): number {
  const { graph, rootSourceGroupId, sourceGroupOrder, openConnections } = search
  const order = sourceGroupOrder.size
  sourceGroupOrder.set(sourceGroupId, order)
  let earliestOrder = order
  for (const connection of graph.get(sourceGroupId) ?? []) {
    if (connection === parentConnection) continue
    const nextSourceGroupId = oppositeSourceGroupId({
      connection,
      sourceGroupId,
    })
    const nextOrder = sourceGroupOrder.get(nextSourceGroupId)
    if (nextOrder !== undefined) {
      if (nextOrder < order) {
        openConnections.push(connection)
        earliestOrder = Math.min(earliestOrder, nextOrder)
      }
      continue
    }
    const start = openConnections.length
    openConnections.push(connection)
    const reachableOrder = visitReceiverCycles({
      search,
      sourceGroupId: nextSourceGroupId,
      parentConnection: connection,
    })
    earliestOrder = Math.min(earliestOrder, reachableOrder)
    if (reachableOrder < order) continue
    const component = openConnections.splice(start)
    if (sourceGroupId !== rootSourceGroupId || component.length < 2) continue
    for (const { edge } of component) {
      if (edge.kind === "routed")
        search.routedCycleTraceIds.push(edge.sourceTraceId)
    }
  }
  return earliestOrder
}

/** Keep cut evidence even when a nearer cycle consists only of parallel passives. */
function bypassedReceiverTraceIds({
  graph,
  sourceGroupId,
}: {
  graph: ReceiverGraph
  sourceGroupId: SourcePortId
}): ReceiverTraceIds {
  const search: ReceiverCycleSearch = {
    graph,
    rootSourceGroupId: sourceGroupId,
    sourceGroupOrder: new Map(),
    openConnections: [],
    routedCycleTraceIds: [],
  }
  visitReceiverCycles({ search, sourceGroupId })
  return search.routedCycleTraceIds
}

/** Include series passives within a leg and exclude the differential terminations. */
function receiverEdges({
  prepared,
  cuts,
  legGroups,
}: {
  prepared: PreparedChannelSimulation
  cuts: readonly RoutedTraceCut[]
  legGroups: SourceNodeGroups
}): (RoutedEdge | SeriesEdge)[] {
  const differential = differentialGroups({
    contacts: differentialContacts(prepared.driverReceiverChannels),
    groups: legGroups,
  })
  const edges: (RoutedEdge | SeriesEdge)[] = cuts.map((cut) => ({
    ...cut,
    kind: "routed",
  }))
  for (const [fromSourcePortId, toSourcePortId] of prepared.routedTopology
    .bridges) {
    if (
      crossesDifferentialLegs({
        from: sourceGroupId({
          groups: legGroups,
          sourcePortId: fromSourcePortId,
        }),
        to: sourceGroupId({ groups: legGroups, sourcePortId: toSourcePortId }),
        differential,
      })
    )
      continue
    edges.push({ kind: "series", fromSourcePortId, toSourcePortId })
  }
  return edges
}

/** Find the ordered path or any routed cycle that an ideal bypass closed at the receiver. */
function mappedTraceIds({
  graph,
  physical,
  groups,
  fromSourcePortId,
  toSourcePortId,
  allowUnroutedTraces,
  channelName,
}: {
  graph: ReceiverGraph
  physical: ReceiverGraph
  groups: SourceNodeGroups
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  allowUnroutedTraces: boolean
  channelName: string
}): ReceiverTraceIds {
  const fromSourceGroupId = sourceGroupId({
    groups,
    sourcePortId: fromSourcePortId,
  })
  const toSourceGroupId = sourceGroupId({
    groups,
    sourcePortId: toSourcePortId,
  })
  if (!allowUnroutedTraces || fromSourceGroupId === toSourceGroupId) {
    const physicalTraceIds = receiverTraceIds({
      graph: physical,
      fromSourceGroupId: fromSourcePortId,
      toSourceGroupId: toSourcePortId,
    })
    if (physicalTraceIds) return physicalTraceIds
    if (allowUnroutedTraces)
      return bypassedReceiverTraceIds({
        graph,
        sourceGroupId: fromSourceGroupId,
      })
  } else {
    const idealTraceIds = receiverTraceIds({
      graph,
      fromSourceGroupId,
      toSourceGroupId,
    })
    if (idealTraceIds) return idealTraceIds
  }
  return fail(
    "channel_net",
    `${channelName}: no source path from ${fromSourcePortId} to ${toSourcePortId}`,
  )
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
  const physicalCutGroups = cutSourceGroups(cuts)
  const idealCutGroups = sourceNodeGroups([
    ...[...groups],
    ...[...physicalCutGroups],
  ])
  const physical = receiverGraph({
    connections: receiverEdges({
      prepared,
      cuts,
      legGroups: physicalCutGroups,
    }),
  })
  const graph = receiverGraph({
    connections: receiverEdges({ prepared, cuts, legGroups: idealCutGroups }),
    groups,
  })
  const mappings: LaneMapping[] = []
  for (const { name, driver, receivers } of prepared.driverReceiverChannels) {
    const driverPorts = endpointPorts(driver)
    for (const receiver of receivers) {
      for (const [leg, toSourcePortId] of endpointPorts(receiver).entries()) {
        const fromSourcePortId = driverPorts[leg]
        const traceIds = mappedTraceIds({
          graph,
          physical,
          groups,
          fromSourcePortId,
          toSourcePortId,
          channelName: name,
          allowUnroutedTraces:
            prepared.channelSimulation.allow_unrouted_traces === true,
        })
        const [sourceTraceId] = traceIds
        if (sourceTraceId === undefined) continue
        const mapping = {
          port: name,
          from: fromSourcePortId,
          to: toSourcePortId,
          sourceTraceId,
        }
        if (traceIds.length > 1)
          mappings.push({ ...mapping, sourceTraceIds: traceIds })
        else mappings.push(mapping)
      }
    }
  }
  return mappings
}
