import type { SourcePortId, SourceTraceId } from "../board"
import type { DiagnosticSubject } from "../kernel"
import {
  type Connection,
  type ConnectionGraph,
  connectionGraph,
  connectionPath,
} from "./connection-paths"
import { fail } from "./diagnostics"
import type { RoutedTraceCut } from "./routed-types"

/** The physical contacts of an extracted trace or series passive. */
export interface ChannelSegment {
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  sourceTraceId?: SourceTraceId
}

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
function segmentPathDescription(segments: readonly ChannelSegment[]): string {
  return segments
    .map(
      ({ sourceTraceId, fromSourcePortId, toSourcePortId }) =>
        `${sourceTraceId ?? "series passive"} (${fromSourcePortId} to ${toSourcePortId})`,
    )
    .join(", ")
}

/** Link the path's real contacts and cuts to its diagnostic. */
function segmentSubjects(
  segments: readonly ChannelSegment[],
): DiagnosticSubject[] {
  const ids = new Set(
    segments.flatMap(({ fromSourcePortId, toSourcePortId, sourceTraceId }) =>
      [fromSourcePortId, toSourcePortId, sourceTraceId].filter(
        (id) => id !== undefined,
      ),
    ),
  )
  return [...ids].map((id) => ({ kind: "record", id }))
}

/** Require a connection to be a bridge and report its concrete cycle otherwise. */
export function validateChannelBridge<NodeId>({
  graph,
  connection,
  physicalGraph,
}: {
  graph: ConnectionGraph<NodeId, ChannelSegment>
  physicalGraph: ConnectionGraph<SourcePortId, ChannelSegment>
  connection: Connection<NodeId, ChannelSegment>
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
  const projectedPath = [...alternate.map((edge) => edge.evidence), evidence]
  if (evidence.sourceTraceId === undefined)
    fail(
      "channel_short",
      `Series passive contacts ${fromSourcePortId} and ${toSourcePortId} are bypassed`,
      { subjects: segmentSubjects(projectedPath) },
    )
  const physicalAlternate = connectionPath({
    graph: physicalGraph,
    fromNodeId: fromSourcePortId,
    toNodeId: toSourcePortId,
    omitted: physicalGraph
      .get(fromSourcePortId)
      ?.find((edge) => edge.evidence === evidence),
  })
  if (physicalAlternate) {
    const path = [...physicalAlternate.map((edge) => edge.evidence), evidence]
    fail(
      "channel_fanout",
      `Routed cuts form a loop: ${segmentPathDescription(path)}`,
      { subjects: segmentSubjects(path) },
    )
  }
  fail(
    "channel_short",
    `Ideal connections close a path across routed cuts: ${segmentPathDescription(projectedPath)}`,
    { subjects: segmentSubjects(projectedPath) },
  )
}
