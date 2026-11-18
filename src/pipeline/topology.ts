import type {
  LayerRef,
  PcbTraceRoutePointVia,
  PcbTraceRoutePointWire,
  Point,
  SourceTrace,
} from "circuit-json"
import {
  ConnectivityMap,
  findConnectedNetworks,
} from "circuit-json-to-connectivity-map"
import {
  type CircuitJson,
  passiveBridges,
  type SimulationPcbDriverReceiverChannel,
  type SourceNetId,
  type SourcePortId,
  sourceConnections,
  sourceNetMembers,
} from "../board"

type CopperPointKey = string
type CopperPoint = Point & { layer: LayerRef }
type CopperGraph = Map<CopperPointKey, Set<CopperPointKey>>

/** A routed copper segment on one board layer. */
interface CopperSegment {
  start: Point
  end: Point
  layer: LayerRef
}

/** Round to the geometry admission grid at 0.00001 mm per grid step. */
const COPPER_POINTS_PER_MM = 1e5
/** Maximum perpendicular distance from a copper segment for a physical junction, in millimeters. */
const COPPER_JOIN_TOLERANCE_MM = 1e-5
/** Fractional tolerance for a junction near either end of a segment. */
const SEGMENT_POSITION_TOLERANCE = 1e-8

/** Extend the source nets through series passives for this block's rail set. */
export function signalTopology({
  circuit,
  rails,
}: {
  circuit: CircuitJson
  rails: ReadonlySet<SourcePortId | SourceNetId>
}): ConnectivityMap {
  const bridges = passiveBridges(circuit, rails)
  return new ConnectivityMap(
    findConnectedNetworks([...sourceConnections(circuit), ...bridges]),
  )
}

/** Select the approached layer when the routed point is a via. */
function routeLayer(
  point: PcbTraceRoutePointWire | PcbTraceRoutePointVia,
  viaSide: "from_layer" | "to_layer",
): LayerRef {
  if (point.route_type === "via") return point[viaSide]
  return point.layer
}

/** Stable physical identity at the geometry admission tolerance. */
function recordCopperPoint(
  points: Map<CopperPointKey, CopperPoint>,
  point: CopperPoint,
): CopperPointKey {
  const x = Math.round(point.x * COPPER_POINTS_PER_MM)
  const y = Math.round(point.y * COPPER_POINTS_PER_MM)
  const key = `${x},${y},${point.layer}`
  points.set(key, point)
  return key
}

/** Add an undirected physical edge. */
function joinCopperPoints(
  graph: CopperGraph,
  {
    a,
    b,
  }: {
    a: CopperPointKey
    b: CopperPointKey
  },
): void {
  if (a === b) return
  if (!graph.has(a)) graph.set(a, new Set())
  if (!graph.has(b)) graph.set(b, new Set())
  graph.get(a)!.add(b)
  graph.get(b)!.add(a)
}

/** All vertices physically reachable from the given terminals. */
function reachable(
  starts: CopperPointKey[],
  graph: CopperGraph,
): Set<CopperPointKey> {
  const found = new Set(starts)
  for (const key of found) {
    for (const next of graph.get(key) ?? []) found.add(next)
  }
  return found
}

/** Selects source traces that touch the signal without touching a reference rail. */
function signalTraces(
  traces: readonly SourceTrace[],
  {
    selected,
    rails,
  }: {
    selected: ReadonlySet<SourcePortId | SourceNetId>
    rails: ReadonlySet<SourcePortId | SourceNetId>
  },
): SourceTrace[] {
  return traces.filter((trace) => {
    const ports = trace.connected_source_port_ids
    return (
      ports.some((port) => selected.has(port)) &&
      !ports.some((port) => rails.has(port))
    )
  })
}

/** Verify physical connectivity through passives and reject branched routed graphs independently of source grouping. */
export function validateSignalGraph({
  circuit,
  signalConnectivity,
  signals,
  rails,
  allowUnroutedTraces,
}: {
  circuit: CircuitJson
  signalConnectivity: ConnectivityMap
  signals: SimulationPcbDriverReceiverChannel[]
  rails: ReadonlySet<SourcePortId | SourceNetId>
  allowUnroutedTraces: boolean
}): void {
  const drivers = signals.map(({ driver }) => {
    if ("source_port_id" in driver) return [driver.source_port_id]
    return [driver.p_source_port_id, driver.n_source_port_id]
  })
  const driverNets = drivers
    .flat()
    .flatMap((port) => [...sourceNetMembers(signalConnectivity, port)])
  const selected = new Set(driverNets)
  const sourceTraces = circuit.filter(
    (record) => record.type === "source_trace",
  )
  const traceIds = new Set(
    signalTraces(sourceTraces, { selected, rails }).map(
      (trace) => trace.source_trace_id,
    ),
  )
  const routes = circuit
    .filter((record) => record.type === "pcb_trace")
    .filter((trace) => traceIds.has(trace.source_trace_id ?? ""))
  const ports = circuit
    .filter((record) => record.type === "pcb_port")
    .filter((port) => selected.has(port.source_port_id))
  const edges: CopperSegment[] = []
  const points = new Map<CopperPointKey, CopperPoint>()
  const connections = circuit.flatMap((record) => {
    if (record.type !== "pcb_via" && record.type !== "pcb_plated_hole")
      return []
    return [
      record.layers.map((layer) =>
        recordCopperPoint(points, { x: record.x, y: record.y, layer }),
      ),
    ]
  })
  for (const { route } of routes) {
    for (const [index, end] of route.entries()) {
      if (end.route_type === "via") {
        const from = recordCopperPoint(points, {
          x: end.x,
          y: end.y,
          layer: end.from_layer,
        })
        const to = recordCopperPoint(points, {
          x: end.x,
          y: end.y,
          layer: end.to_layer,
        })
        connections.push([from, to])
      }
      const start = route[index - 1]
      if (
        !start ||
        start.route_type === "through_pad" ||
        end.route_type === "through_pad"
      )
        continue
      const layer = routeLayer(start, "to_layer")
      if (layer !== routeLayer(end, "from_layer")) continue
      const first = recordCopperPoint(points, { x: start.x, y: start.y, layer })
      const last = recordCopperPoint(points, { x: end.x, y: end.y, layer })
      if (first !== last) edges.push({ start, end, layer })
    }
  }
  // A barrel is one junction across its layers, including any coincident inline via.
  const junctions = new ConnectivityMap(findConnectedNetworks(connections))
  const terminals = new Map<SourcePortId, CopperPointKey[]>()
  for (const { source_port_id, layers, x, y } of ports) {
    const keys = layers.map((layer) => {
      const point = recordCopperPoint(points, { x, y, layer })
      return junctions.getNetConnectedToId(point) ?? point
    })
    terminals.set(source_port_id, keys)
  }
  const graph: CopperGraph = new Map()
  // Split at every physical junction, including a branch terminating inside another segment.
  for (const { start, end, layer } of edges) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const maxCrossProduct = COPPER_JOIN_TOLERANCE_MM * Math.sqrt(lengthSquared)
    const vertices = [...points].flatMap(([key, point]) => {
      if (point.layer !== layer) return []
      const offsetX = point.x - start.x
      const offsetY = point.y - start.y
      const position = (offsetX * dx + offsetY * dy) / lengthSquared
      const withinSegment =
        position >= -SEGMENT_POSITION_TOLERANCE &&
        position <= 1 + SEGMENT_POSITION_TOLERANCE
      if (!withinSegment) return []
      const onTrace = Math.abs(offsetX * dy - offsetY * dx) < maxCrossProduct
      if (!onTrace) return []
      return [{ key: junctions.getNetConnectedToId(key) ?? key, position }]
    })
    vertices.sort((a, b) => a.position - b.position)
    for (let index = 1; index < vertices.length; index++) {
      joinCopperPoints(graph, {
        a: vertices[index - 1].key,
        b: vertices[index].key,
      })
    }
  }
  const copperPoints = new Set(graph.keys())
  for (const [pinA, pinB] of passiveBridges(circuit, rails)) {
    for (const a of terminals.get(pinA) ?? []) {
      for (const b of terminals.get(pinB) ?? [])
        joinCopperPoints(graph, { a, b })
    }
  }
  for (const [index, signal] of signals.entries()) {
    for (const [leg, port] of drivers[index].entries()) {
      const starts = terminals.get(port) ?? []
      const connected = reachable(starts, graph)
      const routed = starts.some((key) => copperPoints.has(key))
      if (routed) {
        const branchAtDriver = starts.some(
          (key) => (graph.get(key)?.size ?? 0) > 1,
        )
        const branchInPath = [...connected].some(
          (key) => (graph.get(key)?.size ?? 0) > 2,
        )
        if (branchAtDriver || branchInPath) {
          throw new Error(
            `Signal "${signal.name}": branched routed graphs are not implemented yet.`,
          )
        }
      }
      if (allowUnroutedTraces) continue
      const receivers = signal.receivers.map((receiver) => {
        if ("source_port_id" in receiver) return receiver.source_port_id
        if (leg === 0) return receiver.p_source_port_id
        return receiver.n_source_port_id
      })
      for (const target of receivers) {
        const targetPoints = terminals.get(target) ?? []
        if (targetPoints.some((key) => connected.has(key))) continue
        throw new Error(
          `Signal "${signal.name}" is not routed between ${port} and ${target}.`,
        )
      }
    }
  }
}
