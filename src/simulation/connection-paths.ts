/** An undirected connection between two electrical nodes with its physical evidence. */
export interface Connection<NodeId, Evidence> {
  fromVertexId: NodeId
  toVertexId: NodeId
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
    const { fromVertexId, toVertexId } = connection
    const nodes = new Set([fromVertexId, toVertexId])
    for (const nodeId of nodes) {
      const incident = graph.get(nodeId)
      if (incident) incident.push(connection)
      else graph.set(nodeId, [connection])
    }
  }
  return graph
}

/** Read the other node of an incident connection. */
function getOppositeVertexId<NodeId, Evidence>({
  connection,
  nodeId,
}: {
  connection: Connection<NodeId, Evidence>
  nodeId: NodeId
}): NodeId {
  if (connection.fromVertexId === nodeId) return connection.toVertexId
  return connection.fromVertexId
}

/** Ordered connections traversed between two nodes. */
type ConnectionPath<NodeId, Evidence> = Connection<NodeId, Evidence>[]

/** Find the shortest path in the selected connection graph. */
export function connectionPath<NodeId, Evidence>({
  graph,
  fromVertexId,
  toVertexId,
  omitted,
}: {
  graph: ConnectionGraph<NodeId, Evidence>
  fromVertexId: NodeId
  toVertexId: NodeId
  omitted?: Connection<NodeId, Evidence>
}): ConnectionPath<NodeId, Evidence> | undefined {
  const reached = new Map<NodeId, Connection<NodeId, Evidence> | null>([
    [fromVertexId, null],
  ])
  for (const nodeId of reached.keys()) {
    if (nodeId === toVertexId) return orderedPath({ reached, toVertexId })
    for (const connection of graph.get(nodeId) ?? []) {
      if (connection === omitted) continue
      const nextNodeId = getOppositeVertexId({ connection, nodeId })
      if (!reached.has(nextNodeId)) reached.set(nextNodeId, connection)
    }
  }
}

/** Follow one predecessor per reached node back to the path's first contact. */
function orderedPath<NodeId, Evidence>({
  reached,
  toVertexId,
}: {
  reached: ReadonlyMap<NodeId, Connection<NodeId, Evidence> | null>
  toVertexId: NodeId
}): ConnectionPath<NodeId, Evidence> {
  const path: ConnectionPath<NodeId, Evidence> = []
  let currentNodeId = toVertexId
  let connection = reached.get(currentNodeId)
  while (connection) {
    path.push(connection)
    currentNodeId = getOppositeVertexId({ connection, nodeId: currentNodeId })
    connection = reached.get(currentNodeId)
  }
  return path.reverse()
}

/** An unfinished depth-first visit and its lowest reachable discovery index. */
interface BridgeVisit<NodeId, Evidence> {
  vertexId: NodeId
  discoveryIndex: number
  lowIndex: number
  incident: Iterator<Connection<NodeId, Evidence>>
  parentConnection?: Connection<NodeId, Evidence>
}

/** The links whose removal disconnects their endpoints in an undirected graph. */
export type ConnectionBridges<NodeId, Evidence> = ReadonlySet<
  Connection<NodeId, Evidence>
>

/** Find every bridge in one traversal, treating parallel links as separate edges. */
export function findConnectionBridges<NodeId, Evidence>(
  graph: ConnectionGraph<NodeId, Evidence>,
): ConnectionBridges<NodeId, Evidence> {
  const discovery = new Map<NodeId, number>()
  const bridges = new Set<Connection<NodeId, Evidence>>()
  for (const [rootVertexId, incident] of graph) {
    if (discovery.has(rootVertexId)) continue
    discovery.set(rootVertexId, discovery.size)
    const rootIndex = discovery.size - 1
    const visits: BridgeVisit<NodeId, Evidence>[] = [
      {
        vertexId: rootVertexId,
        discoveryIndex: rootIndex,
        lowIndex: rootIndex,
        incident: incident.values(),
      },
    ]
    for (let visit = visits.at(-1); visit; visit = visits.at(-1)) {
      const { value: connection, done } = visit.incident.next()
      if (done) {
        visits.pop()
        const parent = visits.at(-1)
        if (!parent || !visit.parentConnection) continue
        if (visit.lowIndex > parent.discoveryIndex)
          bridges.add(visit.parentConnection)
        parent.lowIndex = Math.min(parent.lowIndex, visit.lowIndex)
        continue
      }
      if (connection === visit.parentConnection) continue
      const vertexId = getOppositeVertexId({
        connection,
        nodeId: visit.vertexId,
      })
      const discoveryIndex = discovery.get(vertexId)
      if (discoveryIndex !== undefined) {
        visit.lowIndex = Math.min(visit.lowIndex, discoveryIndex)
        continue
      }
      const nextIncident = graph.get(vertexId)
      if (!nextIncident) continue
      const nextIndex = discovery.size
      discovery.set(vertexId, nextIndex)
      visits.push({
        vertexId,
        discoveryIndex: nextIndex,
        lowIndex: nextIndex,
        incident: nextIncident.values(),
        parentConnection: connection,
      })
    }
  }
  return bridges
}
