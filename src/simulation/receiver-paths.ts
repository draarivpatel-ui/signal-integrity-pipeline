import {
  crossesDifferentialLegs,
  type PassiveBridge,
  type SimulationPcbDriverReceiverChannel,
  type SourcePortId,
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
import {
  nodeGroups,
  type SourceNodeGroups,
  type SourceNodeId,
} from "./source-node-groups"

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
interface ReceiverGraphs {
  groups: SourceNodeGroups
  physical: ConnectionGraph<SourceNodeId, ReceiverEdge>
  ideal: ConnectionGraph<SourceNodeId, ReceiverEdge>
  inferredTerminations: ReadonlySet<ReceiverConnection>
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
    fromNodeId: groups.get(fromSourcePortId) ?? fromSourcePortId,
    toNodeId: groups.get(toSourcePortId) ?? toSourcePortId,
    evidence,
  }
}

/** Index routed cuts and traversable series components for both routing modes. */
export function receiverGraphs({
  cuts,
  bridges,
  groups,
  channels,
}: {
  cuts: readonly RoutedTraceCut[]
  bridges: readonly PassiveBridge[]
  groups: SourceNodeGroups
  channels: readonly Snapshot<SimulationPcbDriverReceiverChannel>[]
}): ReceiverGraphs {
  const physicalCuts = cutConnections({
    cuts,
    node: (sourcePortId) => sourcePortId,
  })
  const physicalCutGroups = nodeGroups(
    physicalCuts.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
  )
  const idealCutGroups = nodeGroups([...groups, ...physicalCutGroups])
  const contacts = differentialContacts(channels)
  const physicalLegs = differentialGroups({
    contacts,
    groups: physicalCutGroups,
  })
  const idealLegs = differentialGroups({ contacts, groups: idealCutGroups })
  const physical: ReceiverConnection[] = [...physicalCuts]
  const ideal: ReceiverConnection[] = cuts.map((evidence) =>
    idealReceiverConnection({ evidence, groups }),
  )
  const inferredTerminations = new Set<ReceiverConnection>()
  for (const [fromSourcePortId, toSourcePortId] of bridges) {
    const fromPhysicalGroupId =
      physicalCutGroups.get(fromSourcePortId) ?? fromSourcePortId
    const toPhysicalGroupId =
      physicalCutGroups.get(toSourcePortId) ?? toSourcePortId
    if (
      crossesDifferentialLegs({
        from: fromPhysicalGroupId,
        to: toPhysicalGroupId,
        differential: physicalLegs,
      })
    )
      continue
    const evidence = { fromSourcePortId, toSourcePortId }
    physical.push({
      fromNodeId: fromSourcePortId,
      toNodeId: toSourcePortId,
      evidence,
    })
    // A short can make a real series component appear to join the legs.
    const connection = idealReceiverConnection({ evidence, groups })
    const fromIdealGroupId =
      idealCutGroups.get(fromSourcePortId) ?? fromSourcePortId
    const toIdealGroupId = idealCutGroups.get(toSourcePortId) ?? toSourcePortId
    if (
      crossesDifferentialLegs({
        from: fromIdealGroupId,
        to: toIdealGroupId,
        differential: idealLegs,
      })
    )
      inferredTerminations.add(connection)
    ideal.push(connection)
  }
  return {
    groups,
    physical: connectionGraph(physical),
    ideal: connectionGraph(ideal),
    inferredTerminations,
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
    discouraged: graphs.inferredTerminations,
    fromNodeId: graphs.groups.get(fromSourcePortId) ?? fromSourcePortId,
    toNodeId: graphs.groups.get(toSourcePortId) ?? toSourcePortId,
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
    rootNodeId: graphs.groups.get(sourcePortId) ?? sourcePortId,
    isCut: (edge) => "sourceTraceId" in edge,
    discouraged: graphs.inferredTerminations,
  })
  return (cycle ?? []).flatMap(({ evidence }) => {
    if ("sourceTraceId" in evidence) return [evidence]
    return []
  })
}
