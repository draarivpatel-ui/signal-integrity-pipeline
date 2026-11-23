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

/** One search queue, recording how each scheduled node would be reached. */
type PathQueue<NodeId, Evidence> = Map<
  NodeId,
  Connection<NodeId, Evidence> | null
>

/** Find a path, visiting routes with fewer discouraged connections first. */
export function connectionPath<NodeId, Evidence>({
  graph,
  fromNodeId,
  toNodeId,
  omitted,
  discouraged,
}: {
  graph: ConnectionGraph<NodeId, Evidence>
  fromNodeId: NodeId
  toNodeId: NodeId
  omitted?: Connection<NodeId, Evidence>
  discouraged?: ReadonlySet<Connection<NodeId, Evidence>>
}): ConnectionPath<NodeId, Evidence> | undefined {
  const queues: PathQueue<NodeId, Evidence>[] = [new Map([[fromNodeId, null]])]
  const reached: PathQueue<NodeId, Evidence> = new Map()
  for (const [priority, queue] of queues.entries()) {
    for (const [nodeId, predecessor] of queue) {
      if (reached.has(nodeId)) continue
      reached.set(nodeId, predecessor)
      if (nodeId === toNodeId) return orderedPath({ reached, toNodeId })
      for (const connection of graph.get(nodeId) ?? []) {
        if (connection === omitted) continue
        const nextNodeId = oppositeNodeId({ connection, nodeId })
        if (reached.has(nextNodeId)) continue
        let next = queue
        if (discouraged?.has(connection))
          next = queues[priority + 1] ??= new Map()
        if (!next.has(nextNodeId)) next.set(nextNodeId, connection)
      }
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

/** One frame of the depth-first search for cycles at a collapsed receiver. */
interface CycleFrame<NodeId, Evidence> {
  nodeId: NodeId
  connections: Iterator<Connection<NodeId, Evidence>>
  earliestOrder: number
  start: number
}

/** Find a physical cut on a cycle with the collapsed receiver's ideal group. */
export function receiverCycle<NodeId, Evidence>({
  graph,
  rootNodeId,
  isCut,
  discouraged,
}: {
  graph: ConnectionGraph<NodeId, Evidence>
  rootNodeId: NodeId
  isCut: (evidence: Evidence) => boolean
  discouraged: ReadonlySet<Connection<NodeId, Evidence>>
}): ConnectionPath<NodeId, Evidence> | undefined {
  const orders = new Map([[rootNodeId, 0]])
  const open: ConnectionPath<NodeId, Evidence> = []
  const stack: CycleFrame<NodeId, Evidence>[] = [
    {
      nodeId: rootNodeId,
      connections: (graph.get(rootNodeId) ?? []).values(),
      earliestOrder: 0,
      start: 0,
    },
  ]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const order = orders.get(frame.nodeId)!
    const next = frame.connections.next()
    if (next.done) {
      stack.pop()
      const parent = stack[stack.length - 1]
      if (!parent) return
      parent.earliestOrder = Math.min(parent.earliestOrder, frame.earliestOrder)
      if (frame.earliestOrder < orders.get(parent.nodeId)!) continue
      const component = open.splice(frame.start)
      if (parent.nodeId !== rootNodeId || component.length < 2) continue
      const routed = component.find(({ evidence }) => isCut(evidence))
      if (!routed) continue
      const path = connectionPath({
        graph: connectionGraph(component),
        fromNodeId: routed.toNodeId,
        toNodeId: routed.fromNodeId,
        omitted: routed,
      })!
      return [routed, ...path]
    }
    const connection = next.value
    if (connection === open[frame.start] || discouraged.has(connection))
      continue
    const nextNodeId = oppositeNodeId({ connection, nodeId: frame.nodeId })
    const nextOrder = orders.get(nextNodeId)
    if (nextOrder !== undefined) {
      if (nextOrder < order) {
        open.push(connection)
        frame.earliestOrder = Math.min(frame.earliestOrder, nextOrder)
      }
      continue
    }
    const start = open.length
    open.push(connection)
    orders.set(nextNodeId, orders.size)
    stack.push({
      nodeId: nextNodeId,
      connections: (graph.get(nextNodeId) ?? []).values(),
      earliestOrder: orders.get(nextNodeId)!,
      start,
    })
  }
}
