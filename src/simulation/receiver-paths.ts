import {
  type CircuitJsonDb,
  type CircuitJsonSnapshot,
  crossesDifferentialLegs,
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
  receiverCycle,
} from "./connection-paths"
import { cutConnections } from "./cut-connections"
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

/** Physical contacts belonging to an extracted trace or a series passive. */
type ReceiverEdge =
  | RoutedTraceCut
  | {
      fromSourcePortId: SourcePortId
      toSourcePortId: SourcePortId
    }

/** One traversal step with its physical contacts. */
type ReceiverConnection = Connection<SourceNodeId, ReceiverEdge>

/** The routed and permissive receiver graphs and the ideal groups they project. */
export interface ReceiverGraphs extends IdealSourceNodes {
  physical: ConnectionGraph<SourceNodeId, ReceiverEdge>
  ideal: ConnectionGraph<SourceNodeId, ReceiverEdge>
  seriesBridges: readonly PassiveBridge[]
}

/** Retain the physical contacts when projecting an edge onto ideal groups. */
function idealReceiverConnection({
  evidence,
  groups,
}: {
  evidence: ReceiverEdge
  groups: SourceNodeGroups
}): ReceiverConnection {
  const { fromSourcePortId, toSourcePortId } = evidence
  return {
    fromNodeId: sourceGroupId({ groups, sourcePortId: fromSourcePortId }),
    toNodeId: sourceGroupId({ groups, sourcePortId: toSourcePortId }),
    evidence,
  }
}

/** Find series passives independently of the joins a mixed routed and ideal path might make. */
function receiverSeriesBridges({
  bridges,
  channels,
  wireGroups,
}: {
  bridges: readonly PassiveBridge[]
  channels: readonly Snapshot<SimulationPcbDriverReceiverChannel>[]
  wireGroups: readonly SourceNodeGroups[]
}): PassiveBridge[] {
  const contacts = differentialContacts(channels)
  const projections = wireGroups.map((groups) => ({
    groups,
    differential: differentialGroups({ contacts, groups }),
  }))
  return bridges.filter(
    ([fromSourcePortId, toSourcePortId]) =>
      !projections.some(({ groups, differential }) => {
        const fromGroupId = sourceGroupId({
          groups,
          sourcePortId: fromSourcePortId,
        })
        const toGroupId = sourceGroupId({
          groups,
          sourcePortId: toSourcePortId,
        })
        return (
          fromGroupId !== toGroupId &&
          crossesDifferentialLegs({
            from: fromGroupId,
            to: toGroupId,
            differential,
          })
        )
      }),
  )
}

/** Resolve ideal groups and index the same series connections for admission and binding. */
export function receiverGraphs({
  db,
  circuit,
  groundSourcePortId,
  modeling,
  cuts,
  additionalSourceTraceIds,
  channels,
}: {
  db: CircuitJsonDb
  circuit: CircuitJsonSnapshot
  groundSourcePortId: SourcePortId
  modeling: Snapshot<SimulationModeling>
  cuts: readonly RoutedTraceCut[]
  additionalSourceTraceIds?: readonly SourceTraceId[]
  channels: readonly Snapshot<SimulationPcbDriverReceiverChannel>[]
}): ReceiverGraphs {
  const idealNodes = idealSourceNodes({ db, cuts, additionalSourceTraceIds })
  const physicalCuts = cutConnections({
    cuts,
    node: (sourcePortId) => sourcePortId,
  })
  const physicalGroups = nodeGroups(
    physicalCuts.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
  )
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
    wireGroups: [physicalGroups, idealNodes.groups],
  })
  const physical = [
    ...physicalCuts,
    ...seriesBridges.map(([fromSourcePortId, toSourcePortId]) => ({
      fromNodeId: fromSourcePortId,
      toNodeId: toSourcePortId,
      evidence: { fromSourcePortId, toSourcePortId },
    })),
  ]
  return {
    ...idealNodes,
    seriesBridges,
    physical: connectionGraph(physical),
    ideal: connectionGraph(
      physical.map(({ evidence }) =>
        idealReceiverConnection({ evidence, groups: idealNodes.groups }),
      ),
    ),
  }
}

/** Ordered path contacts, independent from the routed traces a deck will extract. */
type ReceiverPath = ReceiverEdge[]

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

/** Find the routed part of a closed path through the collapsed receiver group. */
export function receiverBypassCuts({
  graphs,
  sourcePortId,
}: {
  graphs: ReceiverGraphs
  sourcePortId: SourcePortId
}): RoutedTraceCut[] {
  const cycle = receiverCycle({
    graph: graphs.ideal,
    rootNodeId: sourceGroupId({ groups: graphs.groups, sourcePortId }),
    isCut: (edge) => "sourceTraceId" in edge,
  })
  return (cycle ?? []).flatMap(({ evidence }) => {
    if ("sourceTraceId" in evidence) return [evidence]
    return []
  })
}
