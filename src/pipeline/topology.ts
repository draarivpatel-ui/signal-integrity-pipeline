import { Point as PlanarPoint, type Polygon, Segment } from "@flatten-js/core"
import {
  circlePolygon,
  copperPolygonsTouch,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import type {
  LayerRef,
  PcbPort,
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
  segment: Segment
  layer: LayerRef
  startWidth: number
  endWidth: number
}

type CopperPad = CopperPoint & { polygon: Polygon }

/** A point and its fractional position along a routed segment. */
interface SegmentVertex {
  key: CopperPointKey
  position: number
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

/** Record intersections between routes on the same layer. */
function recordCrossings(
  points: Map<CopperPointKey, CopperPoint>,
  edges: CopperSegment[],
): void {
  for (const [index, { layer, segment }] of edges.entries()) {
    for (let other = index + 1; other < edges.length; other++) {
      const edge = edges[other]
      if (layer !== edge.layer) continue
      for (const { x, y } of segment.intersect(edge.segment)) {
        recordCopperPoint(points, { x, y, layer })
      }
    }
  }
}

/** Read the pad outlines explicitly bound to the selected PCB ports. */
function terminalPads(circuit: CircuitJson, ports: PcbPort[]): CopperPad[] {
  const portById = new Map(ports.map((port) => [port.pcb_port_id, port]))
  const rotations = new Map(
    circuit
      .filter((record) => record.type === "pcb_component")
      .map((component) => [component.pcb_component_id, component.rotation]),
  )
  return circuit.flatMap((pad) => {
    if (pad.type !== "pcb_smtpad" && pad.type !== "pcb_plated_hole") return []
    const port = portById.get(pad.pcb_port_id ?? "")
    if (!port) return []
    const { x, y } = port
    if (pad.type === "pcb_smtpad")
      return [{ x, y, layer: pad.layer, polygon: getSmtPadPolygon(pad) }]
    const polygon = getPlatedHolePolygon(
      pad,
      rotations.get(pad.pcb_component_id ?? ""),
    )
    return pad.layers.map((layer) => ({ x, y, layer, polygon }))
  })
}

/** Project a point onto the segment, expressed as a fraction of its length. */
function segmentPosition({ start, end }: Segment, point: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return (
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)
  )
}

/** Find the registered points along a segment, including intersections and terminal centers. */
function segmentVertices(
  points: Map<CopperPointKey, CopperPoint>,
  { segment, layer }: CopperSegment,
): SegmentVertex[] {
  const { start, end } = segment
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const maxCrossProduct = COPPER_JOIN_TOLERANCE_MM * Math.sqrt(lengthSquared)
  const vertices: SegmentVertex[] = []
  for (const [key, point] of points) {
    if (point.layer !== layer) continue
    const offsetX = point.x - start.x
    const offsetY = point.y - start.y
    const position = (offsetX * dx + offsetY * dy) / lengthSquared
    if (
      position < -SEGMENT_POSITION_TOLERANCE ||
      position > 1 + SEGMENT_POSITION_TOLERANCE
    )
      continue
    if (Math.abs(offsetX * dy - offsetY * dx) >= maxCrossProduct) continue
    vertices.push({ key, position })
  }
  return vertices
}

/** Record each pad as one junction with every piece of the segment that touches its copper. */
function padContactGroups(
  points: Map<CopperPointKey, CopperPoint>,
  {
    edge,
    pads,
    vertices,
  }: {
    edge: CopperSegment
    pads: CopperPad[]
    vertices: SegmentVertex[]
  },
): CopperPointKey[][] {
  const { layer, segment, startWidth, endWidth } = edge
  const footprint =
    startWidth > 0
      ? getTraceSegmentPolygon(segment.start, segment.end, startWidth, endWidth)
      : null
  const bounds = footprint?.box ?? segment.box
  const groups: CopperPointKey[][] = []
  for (const pad of pads) {
    if (pad.layer !== layer || bounds.not_intersect(pad.polygon.box)) continue
    if (footprint && !copperPolygonsTouch(footprint, pad.polygon)) continue
    const overlaps = segment.intersect(pad.polygon)
    const contacts = vertices
      .filter(({ key, position }) => {
        const { x, y } = points.get(key)!
        const center = new PlanarPoint(x, y)
        if (pad.polygon.contains(center)) return true
        const radius = (startWidth + (endWidth - startWidth) * position) / 2
        return radius > 0 && center.distanceTo(pad.polygon)[0] <= radius
      })
      .map(({ key }) => key)
    if (!contacts.length && !overlaps.length) {
      if (!footprint) continue
      // The trace edge touches the pad but the centerline misses it.
      const [, distance] = segment.distanceTo(pad.polygon)
      overlaps.push(distance.start)
    }
    for (const { x, y } of overlaps) {
      const key = recordCopperPoint(points, { x, y, layer })
      contacts.push(key)
      vertices.push({ key, position: segmentPosition(segment, { x, y }) })
    }
    groups.push([recordCopperPoint(points, pad), ...contacts])
  }
  return groups
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
      if (first === last) continue
      const segment = new Segment(
        new PlanarPoint(start.x, start.y),
        new PlanarPoint(end.x, end.y),
      )
      const wire =
        start.route_type === "wire"
          ? start
          : end.route_type === "wire"
            ? end
            : undefined
      const startWidth = wire?.start_width ?? wire?.width ?? 0
      const endWidth = wire?.end_width ?? startWidth
      edges.push({ layer, segment, startWidth, endWidth })
    }
  }
  recordCrossings(points, edges)
  const terminalPoints = ports.map(({ source_port_id, layers, x, y }) => ({
    port: source_port_id,
    keys: layers.map((layer) => recordCopperPoint(points, { x, y, layer })),
  }))
  const pads = terminalPads(circuit, ports)
  const routeVertices = edges.map((edge) => {
    const vertices = segmentVertices(points, edge)
    connections.push(...padContactGroups(points, { edge, pads, vertices }))
    return vertices.sort((a, b) => a.position - b.position)
  })
  // Each continuous pad or barrel forms one junction, regardless of its number of contact points.
  const junctions = new ConnectivityMap(findConnectedNetworks(connections))
  const terminals = new Map<SourcePortId, CopperPointKey[]>()
  for (const { port, keys } of terminalPoints) {
    const vertices = keys.map(
      (key) => junctions.getNetConnectedToId(key) ?? key,
    )
    terminals.set(port, [...(terminals.get(port) ?? []), ...vertices])
  }
  const graph: CopperGraph = new Map()
  for (const vertices of routeVertices) {
    for (let index = 1; index < vertices.length; index++) {
      const first = vertices[index - 1].key
      const last = vertices[index].key
      joinCopperPoints(graph, {
        a: junctions.getNetConnectedToId(first) ?? first,
        b: junctions.getNetConnectedToId(last) ?? last,
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
