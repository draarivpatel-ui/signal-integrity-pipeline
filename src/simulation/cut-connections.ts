import type { SourcePortId } from "../board"
import {
  type Connection,
  type ConnectionGraph,
  connectionGraph,
  connectionPath,
} from "./connection-paths"
import { fail } from "./diagnostics"
import type { RoutedTraceCut } from "./routed-types"

/** The physical cut paired with the nodes it now separates. */
export type CutConnection<NodeId> = Connection<NodeId, RoutedTraceCut>

/** Project physical cuts onto source groups or SPICE nodes for traversal. */
export function cutConnections<NodeId>({
  cuts,
  node,
}: {
  cuts: readonly RoutedTraceCut[]
  node: (sourcePortId: SourcePortId) => NodeId
}): CutConnection<NodeId>[] {
  return cuts.map((cut) => ({
    fromNodeId: node(cut.fromSourcePortId),
    toNodeId: node(cut.toSourcePortId),
    evidence: cut,
  }))
}

/** Index physical cuts without projecting them onto ideal groups. */
export function physicalCutGraph(
  cuts: readonly RoutedTraceCut[],
): ConnectionGraph<SourcePortId, RoutedTraceCut> {
  return connectionGraph(
    cutConnections({ cuts, node: (sourcePortId) => sourcePortId }),
  )
}

/** List the physical contacts that identify a closed path. */
function cutPathDescription(cuts: readonly RoutedTraceCut[]): string {
  return cuts
    .map(
      ({ sourceTraceId, fromSourcePortId, toSourcePortId }) =>
        `${sourceTraceId} (${fromSourcePortId} to ${toSourcePortId})`,
    )
    .join(", ")
}

/** Report the physical contacts on the path closed by an ideal connection. */
export function shortedCutPath(cuts: readonly RoutedTraceCut[]): never {
  return fail(
    "channel_short",
    `Ideal connections close a path across routed cuts: ${cutPathDescription(cuts)}`,
  )
}

/** Require a connection to be a bridge and report its concrete cycle otherwise. */
export function validateCutBridge<NodeId>({
  graph,
  connection,
  physicalGraph,
}: {
  graph: ConnectionGraph<NodeId, RoutedTraceCut>
  physicalGraph: ConnectionGraph<SourcePortId, RoutedTraceCut>
  connection: CutConnection<NodeId>
}): void {
  const { fromNodeId, toNodeId, evidence } = connection
  const alternate = connectionPath({
    graph,
    fromNodeId,
    toNodeId,
    omitted: connection,
  })
  if (!alternate) return
  const { fromSourcePortId, toSourcePortId } = evidence
  const physicalAlternate = connectionPath({
    graph: physicalGraph,
    fromNodeId: fromSourcePortId,
    toNodeId: toSourcePortId,
    omitted: physicalGraph
      .get(fromSourcePortId)
      ?.find((edge) => edge.evidence === evidence),
  })
  if (physicalAlternate)
    fail(
      "channel_fanout",
      `Routed cuts form a loop: ${cutPathDescription([...physicalAlternate.map((edge) => edge.evidence), evidence])}`,
    )
  shortedCutPath([...alternate.map((edge) => edge.evidence), evidence])
}
