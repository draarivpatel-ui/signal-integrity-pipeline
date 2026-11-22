import {
  ConnectivityMap,
  findConnectedNetworks,
} from "circuit-json-to-connectivity-map"
import {
  type LaneMapping,
  type SimulationPcbDriverReceiverChannel,
  type SourceNetId,
  type SourcePortId,
  type SourceTraceId,
  sourceNetMembers,
} from "../board"
import type { IdealRoutedJunction } from "../simulation"
import { fail } from "./diagnostics"
import { endpointPorts, type PreparedChannelSimulation } from "./signals"
import { crossesDifferentialLegs } from "./topology"

/** A source port or a named net participating in a receiver path. */
type SourcePortOrNetId = SourcePortId | SourceNetId

/** A source adjacency edge that records how the path traverses the board. */
interface RouteConnection {
  from: SourcePortOrNetId
  to: SourcePortOrNetId
  kind: "routed" | "passive" | "ideal"
  sourceTraceId?: SourceTraceId
}

/** Source adjacency retaining edge order and routed trace labels. */
type RouteConnections = Map<SourcePortOrNetId, RouteConnection[]>

/** An ordered walk from a driver to a receiver. */
type ReceiverPath = readonly RouteConnection[]

/** Receiver mappings and the explicit ideal junctions between their physical cuts. */
interface RoutedReceiverPaths {
  mappings: LaneMapping[]
  idealRoutedJunctions: IdealRoutedJunction[]
}

/** Build the path graph without rails or passive loads across differential legs. */
function channelSimulationRouteConnections({
  routedTopology,
  settings,
  driverReceiverChannels,
}: PreparedChannelSimulation): RouteConnections {
  const { rails, sourceConnectionGroups, bridges } = routedTopology
  const signalGroups = sourceConnectionGroups.filter(
    (group) => !group.some((port) => rails.has(port)),
  )
  const connectivity = new ConnectivityMap(findConnectedNetworks(signalGroups))
  const differential = driverReceiverChannels.flatMap(
    ({ driver, receivers }) => {
      if ("source_port_id" in driver) return []
      const ends = [
        driver,
        ...receivers.filter((receiver) => "p_source_port_id" in receiver),
      ]
      return [
        {
          positive: new Set(
            ends.flatMap((endpoint) => [
              ...sourceNetMembers({
                connectivity,
                memberId: endpoint.p_source_port_id,
              }),
            ]),
          ),
          negative: new Set(
            ends.flatMap((endpoint) => [
              ...sourceNetMembers({
                connectivity,
                memberId: endpoint.n_source_port_id,
              }),
            ]),
          ),
        },
      ]
    },
  )
  const edges: RouteConnection[] = settings.lanes.map(
    ({ from, to, sourceTraceId }) => ({
      from: from.sourcePortId,
      to: to.sourcePortId,
      sourceTraceId,
      kind: "routed",
    }),
  )
  for (const [from, to] of bridges) {
    if (crossesDifferentialLegs({ from, to, differential })) continue
    edges.push({ from, to, kind: "passive" })
  }
  for (const [from, ...targets] of signalGroups) {
    for (const to of targets) edges.push({ from, to, kind: "ideal" })
  }
  const connections: RouteConnections = new Map()
  for (const edge of edges) {
    for (const oriented of [edge, { ...edge, from: edge.to, to: edge.from }]) {
      const neighbors = connections.get(oriented.from) ?? []
      neighbors.push(oriented)
      connections.set(oriented.from, neighbors)
    }
  }
  return connections
}

/** Find the shortest path by visiting each reachable source node once. */
function receiverPath({
  connections,
  from,
  to,
  allowIdeal,
}: {
  connections: RouteConnections
  from: SourcePortId
  to: SourcePortId
  allowIdeal: boolean
}): ReceiverPath | undefined {
  const visited = new Map<SourcePortOrNetId, RouteConnection | null>([
    [from, null],
  ])
  for (const [port] of visited) {
    if (port === to) {
      const path: RouteConnection[] = []
      let edge = visited.get(to)
      while (edge) {
        path.push(edge)
        edge = visited.get(edge.from)
      }
      return path.reverse()
    }
    for (const edge of connections.get(port) ?? []) {
      if (!allowIdeal && edge.kind === "ideal") continue
      if (!visited.has(edge.to)) visited.set(edge.to, edge)
    }
  }
  return undefined
}

/** Identify ideal wires that the selected path uses to join separate physical cuts. */
function idealRoutedJunctions(path: ReceiverPath): IdealRoutedJunction[] {
  const junctions: IdealRoutedJunction[] = []
  let fromSourcePortId: SourcePortId | undefined
  for (const edge of path) {
    if (edge.kind === "ideal") continue
    if (edge.kind === "passive") {
      fromSourcePortId = undefined
      continue
    }
    if (fromSourcePortId !== undefined && fromSourcePortId !== edge.from)
      junctions.push({ fromSourcePortId, toSourcePortId: edge.from })
    fromSourcePortId = edge.to
  }
  return junctions
}

/** Keep each leg on its complete physical path ahead of any parallel ideal shortcut. */
function channelReceiverPaths({
  driverReceiverChannel,
  connections,
  allowUnroutedTraces,
}: {
  driverReceiverChannel: SimulationPcbDriverReceiverChannel
  connections: RouteConnections
  allowUnroutedTraces: boolean
}): RoutedReceiverPaths {
  const mappings: LaneMapping[] = []
  const junctions: IdealRoutedJunction[] = []
  const driverPorts = endpointPorts(driverReceiverChannel.driver)
  for (const receiver of driverReceiverChannel.receivers) {
    for (const [index, to] of endpointPorts(receiver).entries()) {
      const from = driverPorts[index]
      let path = receiverPath({ connections, from, to, allowIdeal: false })
      if (path === undefined && allowUnroutedTraces) {
        path = receiverPath({ connections, from, to, allowIdeal: true })
      }
      if (!path)
        return fail(
          "channel_net",
          `${driverReceiverChannel.name}: no source path from ${from} to ${to}`,
        )
      const traceIds = path.flatMap(({ sourceTraceId }) =>
        sourceTraceId === undefined ? [] : [sourceTraceId],
      )
      const [sourceTraceId] = traceIds
      if (sourceTraceId === undefined) continue
      const mapping = {
        port: driverReceiverChannel.name,
        from,
        to,
        sourceTraceId,
      }
      if (traceIds.length > 1)
        mappings.push({ ...mapping, sourceTraceIds: traceIds })
      else mappings.push(mapping)
      junctions.push(...idealRoutedJunctions(path))
    }
  }
  return { mappings, idealRoutedJunctions: junctions }
}

/** Identify routed traces and ideal junctions along the declared receiver paths. */
export function routedReceiverPaths(
  prepared: PreparedChannelSimulation,
): RoutedReceiverPaths {
  if (!prepared.settings.lanes.length)
    return { mappings: [], idealRoutedJunctions: [] }
  const connections = channelSimulationRouteConnections(prepared)
  const paths = prepared.driverReceiverChannels.map((driverReceiverChannel) =>
    channelReceiverPaths({
      driverReceiverChannel,
      connections,
      allowUnroutedTraces: prepared.channelSimulation.allow_unrouted_traces,
    }),
  )
  return {
    mappings: paths.flatMap(({ mappings }) => mappings),
    idealRoutedJunctions: paths.flatMap(
      ({ idealRoutedJunctions }) => idealRoutedJunctions,
    ),
  }
}
