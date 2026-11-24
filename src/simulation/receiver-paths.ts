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
  selectPort,
} from "../board"
import type { Snapshot } from "../kernel"
import {
  type Connection,
  type ConnectionGraph,
  connectionGraph,
  connectionPath,
} from "./connection-paths"
import { type ChannelSegment, cutConnections } from "./cut-connections"
import {
  differentialContacts,
  differentialGroups,
} from "./differential-contacts"
import type { RoutedTraceCut } from "./routed-types"
import { signalRailIds } from "./signal-rails"
import {
  type IdealSourceNodes,
  idealSourceNodes,
  nodeGroups,
  type SourceNodeGroups,
  type SourceNodeId,
  sourceGroupId,
} from "./source-node-groups"
import type { SimulationModeling } from "./types"

/** One traversal step with its physical contacts. */
type ReceiverConnection = Connection<SourceNodeId, ChannelSegment>

/** The routed and permissive receiver graphs and the ideal groups they project. */
export interface ReceiverGraphs extends IdealSourceNodes {
  physical: ConnectionGraph<SourceNodeId, ChannelSegment>
  ideal: ConnectionGraph<SourceNodeId, ChannelSegment>
  channelConnections: readonly ReceiverConnection[]
}

/** Retain the physical contacts when projecting an edge onto ideal groups. */
function idealReceiverConnection({
  evidence,
  groups,
}: {
  evidence: ChannelSegment
  groups: SourceNodeGroups
}): ReceiverConnection {
  const { fromSourcePortId, toSourcePortId } = evidence
  return {
    fromNodeId: sourceGroupId({ groups, sourcePortId: fromSourcePortId }),
    toNodeId: sourceGroupId({ groups, sourcePortId: toSourcePortId }),
    evidence,
  }
}

/** A raw wire or passive edge used to distinguish a shorted series path from a termination. */
type WireOrPassive = Connection<SourceNodeId, PassiveBridge | null>

/** Find series bridge evidence without traversing the opposite leg's wire backbone. */
function seriesOnLeg({
  sourcePortIds,
  oppositeSourcePortIds,
  wireGraph,
  connections,
}: {
  sourcePortIds: readonly SourcePortId[]
  oppositeSourcePortIds: readonly SourcePortId[]
  wireGraph: ConnectionGraph<SourceNodeId, PassiveBridge | null>
  connections: readonly WireOrPassive[]
}): ReadonlySet<PassiveBridge> {
  const [oppositeDriver, ...oppositeReceivers] = oppositeSourcePortIds
  const oppositeWires = new Set(
    oppositeReceivers.flatMap(
      (toNodeId) =>
        connectionPath({
          graph: wireGraph,
          fromNodeId: oppositeDriver,
          toNodeId,
        }) ?? [],
    ),
  )
  const oppositePorts = new Set<SourceNodeId>(oppositeSourcePortIds)
  const graph = connectionGraph(
    connections.filter(
      (connection) =>
        !oppositePorts.has(connection.fromNodeId) &&
        !oppositePorts.has(connection.toNodeId) &&
        !oppositeWires.has(connection),
    ),
  )
  const [fromNodeId, ...receivers] = sourcePortIds
  return new Set(
    receivers.flatMap((toNodeId) =>
      (connectionPath({ graph, fromNodeId, toNodeId }) ?? []).flatMap(
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
  wires: SourceNodeId[][]
}): PassiveBridge[] {
  const contacts = differentialContacts(channels)
  if (!contacts.length) return [...bridges]
  const groups = nodeGroups(wires)
  const differential = differentialGroups({ contacts, groups })
  const wireConnections = wires.flatMap(([fromNodeId, ...toNodeIds]) =>
    toNodeIds.map(
      (toNodeId): WireOrPassive => ({ fromNodeId, toNodeId, evidence: null }),
    ),
  )
  const wireGraph = connectionGraph(wireConnections)
  const connections = [
    ...wireConnections,
    ...bridges.map(
      (bridge): WireOrPassive => ({
        fromNodeId: bridge[0],
        toNodeId: bridge[1],
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
      const from = sourceGroupId({ groups, sourcePortId: fromSourcePortId })
      const to = sourceGroupId({ groups, sourcePortId: toSourcePortId })
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
  groups: SourceNodeGroups
}): ReceiverConnection[] {
  const networks = nodeGroups(
    idealConnections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
  )
  const signalGroups = channels.flatMap(({ driver, receivers }) =>
    [driver, ...receivers]
      .flatMap(endpointPorts)
      .map((sourcePortId) => sourceGroupId({ groups, sourcePortId })),
  )
  const channelNetworks = new Set(
    [
      ...signalGroups,
      ...idealConnections
        .filter(({ evidence }) => evidence.sourceTraceId !== undefined)
        .map(({ fromNodeId }) => fromNodeId),
    ].map((sourceNodeId) => networks.get(sourceNodeId)),
  )
  return idealConnections.filter(({ fromNodeId }) =>
    channelNetworks.has(networks.get(fromNodeId)),
  )
}

/** Resolve ideal groups and index the same series connections for channel planning and binding. */
export function receiverGraphs({
  db,
  circuit,
  groundSourcePortId,
  modeling,
  cuts,
  channels,
}: {
  db: CircuitJsonUtilObjects
  circuit: CircuitJson
  groundSourcePortId: SourcePortId
  modeling: Snapshot<SimulationModeling>
  cuts: readonly RoutedTraceCut[]
  channels: readonly SimulationPcbDriverReceiverChannel[]
}): ReceiverGraphs {
  const idealNodes = idealSourceNodes({ db, cuts })
  const physicalCuts = cutConnections({
    cuts,
    node: (sourcePortId) => sourcePortId,
  })
  const referenceIds = (modeling.supplies ?? []).flatMap(
    ({ positive, negative }) =>
      [positive, negative].map(
        (selector) => selectPort({ circuit, selector }).source_port_id,
      ),
  )
  const rails = signalRailIds({
    db,
    connectivity: getSourcePortConnectivityMapFromCircuitJson(circuit),
    referenceIds: [groundSourcePortId, ...referenceIds],
  })
  const seriesBridges = receiverSeriesBridges({
    bridges: passiveBridges({ circuit, excluded: rails }),
    channels,
    wires: [
      ...idealNodes.wireConnections,
      ...physicalCuts.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
    ],
  })
  const physical = [
    ...physicalCuts,
    ...seriesBridges.map(([fromSourcePortId, toSourcePortId]) => ({
      fromNodeId: fromSourcePortId,
      toNodeId: toSourcePortId,
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
    fromNodeId: fromSourcePortId,
    toNodeId: toSourcePortId,
  })
  if (physical) return physical.map(({ evidence }) => evidence)
  if (!allowUnroutedTraces) return
  return connectionPath({
    graph: graphs.ideal,
    fromNodeId: sourceGroupId({
      groups: graphs.groups,
      sourcePortId: fromSourcePortId,
    }),
    toNodeId: sourceGroupId({
      groups: graphs.groups,
      sourcePortId: toSourcePortId,
    }),
  })?.map(({ evidence }) => evidence)
}
