/** An undirected connection between two electrical nodes with its physical evidence. */
export interface Connection<NodeId, Evidence> {
  fromNodeId: NodeId
  toNodeId: NodeId
  evidence: Evidence
}

/** Electrical nodes indexed by their incident connections. */
export type ConnectionGraph<NodeId, Evidence> = ReadonlyMap<
  NodeId,
  readonly Connection<NodeId, Evidence>[]
>

/** Index connections at both nodes, including contacts that already share a node. */
export function connectionGraph<NodeId, Evidence>(
  connections: readonly Connection<NodeId, Evidence>[],
): ConnectionGraph<NodeId, Evidence> {
  const graph = new Map<NodeId, Connection<NodeId, Evidence>[]>()
  for (const connection of connections) {
    const { fromNodeId, toNodeId } = connection
    const nodes = new Set([fromNodeId, toNodeId])
    for (const nodeId of nodes) {
      const incident = graph.get(nodeId)
      if (incident) incident.push(connection)
      else graph.set(nodeId, [connection])
    }
  }
  return graph
}

/** Read the other node of an incident connection. */
function oppositeNodeId<NodeId, Evidence>({
  connection,
  nodeId,
}: {
  connection: Connection<NodeId, Evidence>
  nodeId: NodeId
}): NodeId {
  if (connection.fromNodeId === nodeId) return connection.toNodeId
  return connection.fromNodeId
}

/** Ordered connections traversed between two nodes. */
type ConnectionPath<NodeId, Evidence> = Connection<NodeId, Evidence>[]

/** Find the shortest path in the selected connection graph. */
export function connectionPath<NodeId, Evidence>({
  graph,
  fromNodeId,
  toNodeId,
  omitted,
}: {
  graph: ConnectionGraph<NodeId, Evidence>
  fromNodeId: NodeId
  toNodeId: NodeId
  omitted?: Connection<NodeId, Evidence>
}): ConnectionPath<NodeId, Evidence> | undefined {
  const reached = new Map<NodeId, Connection<NodeId, Evidence> | null>([
    [fromNodeId, null],
  ])
  for (const nodeId of reached.keys()) {
    if (nodeId === toNodeId) return orderedPath({ reached, toNodeId })
    for (const connection of graph.get(nodeId) ?? []) {
      if (connection === omitted) continue
      const nextNodeId = oppositeNodeId({ connection, nodeId })
      if (!reached.has(nextNodeId)) reached.set(nextNodeId, connection)
    }
  }
}

/** Follow one predecessor per reached node back to the path's first contact. */
function orderedPath<NodeId, Evidence>({
  reached,
  toNodeId,
}: {
  reached: ReadonlyMap<NodeId, Connection<NodeId, Evidence> | null>
  toNodeId: NodeId
}): ConnectionPath<NodeId, Evidence> {
  const path: ConnectionPath<NodeId, Evidence> = []
  let currentNodeId = toNodeId
  let connection = reached.get(currentNodeId)
  while (connection) {
    path.push(connection)
    currentNodeId = oppositeNodeId({ connection, nodeId: currentNodeId })
    connection = reached.get(currentNodeId)
  }
  return path.reverse()
}
