import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  crossesDifferentialLegs,
  endpointPorts,
  getSourcePortConnectivityMapFromCircuitJson,
  type PassiveBridge,
  passiveBridges,
  type SimulationPcbDriverReceiverChannel,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
} from "../board"
import type { Snapshot } from "../kernel"
import {
  type Connection,
  type ConnectionGraph,
  connectionGraph,
  connectionPath,
} from "./connection-paths"
import {
  differentialContacts,
  differentialGroups,
} from "./differential-contacts"
import {
  getIdealGroupId,
  type IdealConnectivity,
  type IdealGroups,
  nodeGroups,
  resolveIdealConnectivity,
  type SourceContactId,
} from "./ideal-connectivity"
import type { TraceContacts } from "./route-inputs"
import { signalRailIds } from "./signal-rails"
import { type ChannelSegment, connectTraces } from "./trace-connections"
import type { SimulationModeling } from "./types"

/** One traversal step with its physical contacts. */
type ReceiverConnection = Connection<SourceContactId, ChannelSegment>

/** The routed and permissive receiver graphs and the ideal groups they project. */
export interface ReceiverGraphs extends IdealConnectivity {
  physical: ConnectionGraph<SourceContactId, ChannelSegment>
  ideal: ConnectionGraph<SourceContactId, ChannelSegment>
  channelConnections: readonly ReceiverConnection[]
}

/** Retain the physical contacts when projecting an edge onto ideal groups. */
function idealReceiverConnection({
  evidence,
  groups,
}: {
  evidence: ChannelSegment
  groups: IdealGroups
}): ReceiverConnection {
  const { fromSourcePortId, toSourcePortId } = evidence
  return {
    fromVertexId: getIdealGroupId({ groups, sourcePortId: fromSourcePortId }),
    toVertexId: getIdealGroupId({ groups, sourcePortId: toSourcePortId }),
    evidence,
  }
}

/** A raw wire or passive edge used to distinguish a shorted series path from a termination. */
type WireOrPassive = Connection<SourceContactId, PassiveBridge | null>

/** Find series bridge evidence without traversing the opposite leg's wire backbone. */
function seriesOnLeg({
  sourcePortIds,
  oppositeSourcePortIds,
  wireGraph,
  connections,
}: {
  sourcePortIds: readonly SourcePortId[]
  oppositeSourcePortIds: readonly SourcePortId[]
  wireGraph: ConnectionGraph<SourceContactId, PassiveBridge | null>
  connections: readonly WireOrPassive[]
}): ReadonlySet<PassiveBridge> {
  const [oppositeDriver, ...oppositeReceivers] = oppositeSourcePortIds
  const oppositeWires = new Set(
    oppositeReceivers.flatMap(
      (toVertexId) =>
        connectionPath({
          graph: wireGraph,
          fromVertexId: oppositeDriver,
          toVertexId,
        }) ?? [],
    ),
  )
  const oppositePorts = new Set<SourceContactId>(oppositeSourcePortIds)
  const graph = connectionGraph(
    connections.filter(
      (connection) =>
        !oppositePorts.has(connection.fromVertexId) &&
        !oppositePorts.has(connection.toVertexId) &&
        !oppositeWires.has(connection),
    ),
  )
  const [fromVertexId, ...receivers] = sourcePortIds
  return new Set(
    receivers.flatMap((toVertexId) =>
      (connectionPath({ graph, fromVertexId, toVertexId }) ?? []).flatMap(
        ({ evidence }) => {
          if (evidence) return [evidence]
          return []
        },
      ),
    ),
  )
}

/** Exclude terminations across combined wire groups and retain genuine shorted series paths. */
function receiverSeriesBridges({
  bridges,
  channels,
  wires,
}: {
  bridges: readonly PassiveBridge[]
  channels: readonly SimulationPcbDriverReceiverChannel[]
  wires: SourceContactId[][]
}): PassiveBridge[] {
  const contacts = differentialContacts(channels)
  if (!contacts.length) return [...bridges]
  const groups = nodeGroups(wires)
  const differential = differentialGroups({ contacts, groups })
  const wireConnections = wires.flatMap(([fromVertexId, ...toNodeIds]) =>
    toNodeIds.map(
      (toVertexId): WireOrPassive => ({
        fromVertexId,
        toVertexId,
        evidence: null,
      }),
    ),
  )
  const wireGraph = connectionGraph(wireConnections)
  const connections = [
    ...wireConnections,
    ...bridges.map(
      (bridge): WireOrPassive => ({
        fromVertexId: bridge[0],
        toVertexId: bridge[1],
        evidence: bridge,
      }),
    ),
  ]
  const terminations = new Set<PassiveBridge>()
  for (const [
    index,
    { positiveSourcePortIds, negativeSourcePortIds },
  ] of contacts.entries()) {
    const crossing = bridges.filter(([fromSourcePortId, toSourcePortId]) => {
      const from = getIdealGroupId({ groups, sourcePortId: fromSourcePortId })
      const to = getIdealGroupId({ groups, sourcePortId: toSourcePortId })
      return (
        from !== to &&
        crossesDifferentialLegs({
          from,
          to,
          differential: [differential[index]],
        })
      )
    })
    if (!crossing.length) continue
    const positiveSeries = seriesOnLeg({
      sourcePortIds: positiveSourcePortIds,
      oppositeSourcePortIds: negativeSourcePortIds,
      wireGraph,
      connections,
    })
    const negativeSeries = seriesOnLeg({
      sourcePortIds: negativeSourcePortIds,
      oppositeSourcePortIds: positiveSourcePortIds,
      wireGraph,
      connections,
    })
    for (const bridge of crossing)
      if (!positiveSeries.has(bridge) && !negativeSeries.has(bridge))
        terminations.add(bridge)
  }
  return bridges.filter((bridge) => !terminations.has(bridge))
}

/** Include passive segments only in components with a routed cut or a declared signal contact. */
function channelConnections({
  idealConnections,
  channels,
  groups,
}: {
  idealConnections: readonly ReceiverConnection[]
  channels: readonly SimulationPcbDriverReceiverChannel[]
  groups: IdealGroups
}): ReceiverConnection[] {
  const networks = nodeGroups(
    idealConnections.map(({ fromVertexId, toVertexId }) => [
      fromVertexId,
      toVertexId,
    ]),
  )
  const signalGroups = channels.flatMap(({ driver, receivers }) =>
    [driver, ...receivers]
      .flatMap(endpointPorts)
      .map((sourcePortId) => getIdealGroupId({ groups, sourcePortId })),
  )
  const channelNetworks = new Set(
    [
      ...signalGroups,
      ...idealConnections
        .filter(({ evidence }) => evidence.sourceTraceId !== undefined)
        .map(({ fromVertexId }) => fromVertexId),
    ].map((sourceNodeId) => networks.get(sourceNodeId)),
  )
  return idealConnections.filter(({ fromVertexId }) =>
    channelNetworks.has(networks.get(fromVertexId)),
  )
}

/** Resolve ideal groups and index the same series connections for channel planning and binding. */
export function receiverGraphs({
  db,
  circuit,
  groundSourcePortId,
  modeling,
  cuts,
  additionalSourceTraceIds,
  channels,
}: {
  db: CircuitJsonUtilObjects
  circuit: CircuitJson
  groundSourcePortId: SourcePortId
  modeling: Snapshot<SimulationModeling>
  cuts: readonly TraceContacts[]
  additionalSourceTraceIds?: readonly SourceTraceId[]
  channels: readonly SimulationPcbDriverReceiverChannel[]
}): ReceiverGraphs {
  const idealNodes = resolveIdealConnectivity({
    db,
    cuts,
    additionalSourceTraceIds,
  })
  const physicalCuts = connectTraces({
    cuts,
    node: (sourcePortId) => sourcePortId,
  })
  const referenceSourcePortIds = (modeling.supplies ?? []).flatMap(
    ({ positive, negative }) =>
      [positive, negative].map(
        (selector) => selectPort({ circuit, selector }).source_port_id,
      ),
  )
  const rails = signalRailIds({
    db,
    connectivity: getSourcePortConnectivityMapFromCircuitJson(circuit),
    referenceSourcePortIds: [groundSourcePortId, ...referenceSourcePortIds],
  })
  const seriesBridges = receiverSeriesBridges({
    bridges: passiveBridges({ circuit, excluded: rails }),
    channels,
    wires: [
      ...idealNodes.wireConnections,
      ...physicalCuts.map(({ fromVertexId, toVertexId }) => [
        fromVertexId,
        toVertexId,
      ]),
    ],
  })
  const physical = [
    ...physicalCuts,
    ...seriesBridges.map(([fromSourcePortId, toSourcePortId]) => ({
      fromVertexId: fromSourcePortId,
      toVertexId: toSourcePortId,
      evidence: { fromSourcePortId, toSourcePortId },
    })),
  ]
  const idealConnections = physical.map(({ evidence }) =>
    idealReceiverConnection({ evidence, groups: idealNodes.groups }),
  )
  return {
    ...idealNodes,
    physical: connectionGraph(physical),
    ideal: connectionGraph(idealConnections),
    channelConnections: channelConnections({
      idealConnections,
      channels,
      groups: idealNodes.groups,
    }),
  }
}

/** Ordered path contacts, independent from the routed traces a deck will extract. */
type ReceiverPath = ChannelSegment[]

/** Prefer a physical path; allow ideal connections to complete a partial route. */
export function receiverPath({
  graphs,
  fromSourcePortId,
  toSourcePortId,
  allowUnroutedTraces,
}: {
  graphs: ReceiverGraphs
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  allowUnroutedTraces: boolean
}): ReceiverPath | undefined {
  const physical = connectionPath({
    graph: graphs.physical,
    fromVertexId: fromSourcePortId,
    toVertexId: toSourcePortId,
  })
  if (physical) return physical.map(({ evidence }) => evidence)
  if (!allowUnroutedTraces) return
  return connectionPath({
    graph: graphs.ideal,
    fromVertexId: getIdealGroupId({
      groups: graphs.groups,
      sourcePortId: fromSourcePortId,
    }),
    toVertexId: getIdealGroupId({
      groups: graphs.groups,
      sourcePortId: toSourcePortId,
    }),
  })?.map(({ evidence }) => evidence)
}
