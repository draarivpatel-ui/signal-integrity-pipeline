import type {
  LaneMapping,
  SimulationPcbDriverReceiverChannel,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "../board"
import { fail } from "./diagnostics"
import { endpointPorts, type PreparedChannelSimulation } from "./signals"

/** A source port or a named net participating in a receiver path. */
type SourcePortOrNetId = SourcePortId | SourceNetId

/** Ordered routed trace identifiers along a receiver path. */
type PathTraceIds = SourceTraceId[]

/** A path edge and its optional extracted source trace. */
interface RouteConnection {
  to: SourcePortOrNetId
  sourceTraceId?: SourceTraceId
}
/** Source adjacency retaining edge order and routed trace labels. */
type RouteConnections = Map<SourcePortOrNetId, RouteConnection[]>

/** Undirected source connection, optionally carried by an extracted trace. */
type RouteEdge = RouteConnection & { from: SourcePortOrNetId }

/** Build the validated source topology, excluding reference rails and labeling routed traces. */
function channelSimulationRouteConnections({
  routedTopology,
  settings,
}: PreparedChannelSimulation): RouteConnections {
  const connections: RouteConnections = new Map()
  const { rails, sourceConnectionGroups } = routedTopology
  const edges: RouteEdge[] = []
  // Visit routed parallels first when a source trace also declares the same connection.
  for (const lane of settings.lanes) {
    const { from, to, sourceTraceId } = lane
    edges.push({
      from: from.sourcePortId,
      to: to.sourcePortId,
      sourceTraceId,
    })
  }
  for (const [from, ...targets] of sourceConnectionGroups) {
    if (rails.has(from)) continue
    for (const to of targets) edges.push({ from, to })
  }
  for (const { from, to, sourceTraceId } of edges) {
    for (const [a, b] of [
      [from, to],
      [to, from],
    ]) {
      const neighbors = connections.get(a) ?? []
      neighbors.push({ to: b, sourceTraceId })
      connections.set(a, neighbors)
    }
  }
  return connections
}

/** Find a receiver path by visiting source nodes in breadth-first order. */
function pathTraceIds({
  connections,
  from,
  to,
}: {
  connections: RouteConnections
  from: SourcePortId
  to: SourcePortId
}): PathTraceIds | undefined {
  const paths = new Map<SourcePortOrNetId, PathTraceIds>([[from, []]])
  for (const [node, traceIds] of paths) {
    if (node === to) return traceIds
    for (const neighbor of connections.get(node) ?? []) {
      if (paths.has(neighbor.to)) continue
      const { sourceTraceId } = neighbor
      if (sourceTraceId !== undefined) {
        paths.set(neighbor.to, [...traceIds, sourceTraceId])
        continue
      }
      paths.set(neighbor.to, traceIds)
    }
  }
  return undefined
}

/** Match each receiver leg with the extracted traces along the corresponding driver path. */
function receiverMappings({
  driverReceiverChannel,
  connections,
}: {
  driverReceiverChannel: SimulationPcbDriverReceiverChannel
  connections: RouteConnections
}): LaneMapping[] {
  const driverPorts = endpointPorts(driverReceiverChannel.driver)
  return driverReceiverChannel.receivers.flatMap((receiver) =>
    endpointPorts(receiver).flatMap((to, i) => {
      const from = driverPorts[i]
      const sourceTraceIds = pathTraceIds({ connections, from, to })
      if (!sourceTraceIds)
        return fail(
          "channel_net",
          `${driverReceiverChannel.name}: no source path from ${from} to ${to}`,
        )
      const [sourceTraceId] = sourceTraceIds
      if (sourceTraceId === undefined) return []
      const mapping: LaneMapping = {
        port: driverReceiverChannel.name,
        from,
        to,
        sourceTraceId,
      }
      if (sourceTraceIds.length > 1) mapping.sourceTraceIds = sourceTraceIds
      return [mapping]
    }),
  )
}

/** Identify routed traces along the declared paths used by receiver consumers. */
export function routedReceiverMappings(
  prepared: PreparedChannelSimulation,
): LaneMapping[] {
  if (!prepared.settings.lanes.length) return []
  const connections = channelSimulationRouteConnections(prepared)
  return prepared.driverReceiverChannels.flatMap((driverReceiverChannel) =>
    receiverMappings({ driverReceiverChannel, connections }),
  )
}
