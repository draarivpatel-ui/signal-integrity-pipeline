import type { SourcePortId } from "../board"
import {
  type Connection,
  type connectionGraph,
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

/** Report the physical contacts on the path closed by an ideal connection. */
export function shortedCutPath(cuts: readonly RoutedTraceCut[]): never {
  return fail(
    "channel_short",
    `Ideal connections close a path across routed cuts: ${cuts
      .map(
        ({ sourceTraceId, fromSourcePortId, toSourcePortId }) =>
          `${sourceTraceId} (${fromSourcePortId} to ${toSourcePortId})`,
      )
      .join(", ")}`,
  )
}

/** Require a connection to be a bridge and report its concrete cycle otherwise. */
export function validateCutBridge<NodeId>({
  graph,
  connection,
}: {
  graph: ReturnType<typeof connectionGraph<NodeId, RoutedTraceCut>>
  connection: CutConnection<NodeId>
}): void {
  const { fromNodeId, toNodeId, evidence } = connection
  const alternate = connectionPath({
    graph,
    fromNodeId,
    toNodeId,
    omitted: connection,
  })
  if (alternate)
    shortedCutPath([...alternate.map((edge) => edge.evidence), evidence])
}
