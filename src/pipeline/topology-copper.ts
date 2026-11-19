import { Point as PlanarPoint, type Polygon, Vector } from "@flatten-js/core"
import {
  circlePolygon,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import type {
  LayerRef,
  PcbPort,
  PcbTrace,
  PcbTraceRoutePoint,
  Point,
} from "circuit-json"
import { findConnectedNetworks } from "circuit-json-to-connectivity-map"
import type { CircuitJson, SourcePortId } from "../board"

/** A quantized point or the key of a copper feature that acts as one junction. */
export type CopperPointKey = string
/** Distinct physical neighbors at each junction. */
export type CopperGraph = Record<CopperPointKey, Set<CopperPointKey>>
/** Selected PCB terminal junctions by their source port. */
type CopperTerminals = Map<SourcePortId, CopperPointKey[]>
/** Copper adjacency and the terminals it connects to. */
interface RoutedCopper {
  graph: CopperGraph
  terminals: CopperTerminals
  routed: ReadonlySet<CopperPointKey>
}

/** An outline on one layer with a key shared across a pad or barrel. */
interface CopperRegion {
  layer: LayerRef
  outline: Polygon
  key: CopperPointKey
}

/** The interval along a wire occupied by one copper contact. */
interface CopperContact {
  key: CopperPointKey
  start: number
  end: number
}

/** One wire segment with the contacts that will split it into graph edges. */
interface CopperWire {
  layer: LayerRef
  outline: Polygon
  origin: PlanarPoint
  direction: Vector
  length: number
  contacts: CopperContact[]
}

/** One group of keys to collapse to a single junction. */
type CopperGroup = CopperPointKey[]

/** Point grid spacing and maximum outline separation treated as contact, in millimeters. */
const COPPER_TOLERANCE_MM = 1e-5

/** Keep physical point identity stable across routes on the same layer. */
function pointKey({
  point,
  layer,
}: {
  point: Point
  layer: LayerRef
}): CopperPointKey {
  const x = Math.round(point.x / COPPER_TOLERANCE_MM)
  const y = Math.round(point.y / COPPER_TOLERANCE_MM)
  return `${x},${y},${layer}`
}

/** Compare the occupied outline on either side of a possible copper contact. */
function outlineContact({ a, b }: { a: Polygon; b: Polygon }): PlanarPoint[] {
  if (!a.box.extend(COPPER_TOLERANCE_MM).intersect(b.box)) return []
  const points = [
    ...a.intersect(b),
    ...a.vertices.filter((point) => b.contains(point)),
    ...b.vertices.filter((point) => a.contains(point)),
  ]
  if (points.length) return points
  const [distance, nearest] = a.distanceTo(b)
  if (distance > COPPER_TOLERANCE_MM) return []
  return [nearest.start, nearest.end]
}

/** Project the actual area of copper contact onto the length of a wire. */
function registerContact({
  wire,
  key,
  points,
}: {
  wire: CopperWire
  key: CopperPointKey
  points: PlanarPoint[]
}): void {
  const positions = points.map((point) =>
    Math.max(
      0,
      Math.min(wire.length, new Vector(wire.origin, point).dot(wire.direction)),
    ),
  )
  wire.contacts.push({
    key,
    start: Math.min(...positions),
    end: Math.max(...positions),
  })
}

/** Put coplanar pads, barrels and overlapping wires in the ordered contacts of each wire. */
function registerOutlineContacts({
  wires,
  regions,
}: {
  wires: CopperWire[]
  regions: CopperRegion[]
}): void {
  for (const [index, wire] of wires.entries()) {
    for (const { layer, outline, key } of regions) {
      if (wire.layer !== layer) continue
      const points = outlineContact({ a: wire.outline, b: outline })
      if (points.length) registerContact({ wire, key, points })
    }
    for (let otherIndex = index + 1; otherIndex < wires.length; otherIndex++) {
      const other = wires[otherIndex]
      if (wire.layer !== other.layer) continue
      const points = outlineContact({ a: wire.outline, b: other.outline })
      if (!points.length) continue
      const key = `contact:${index}:${otherIndex}`
      registerContact({ wire, key, points })
      registerContact({ wire: other, key, points })
    }
  }
}

/** A route point that can be an end of a wire. Through-pad copper comes from the pad record. */
type WireEnd = Exclude<PcbTraceRoutePoint, { route_type: "through_pad" }>

/** Build one wire, reading taper widths from the route point that supplies the wire. */
function routeWire({
  start,
  end,
}: {
  start: WireEnd
  end: WireEnd
}): CopperWire | undefined {
  const layer = start.route_type === "via" ? start.to_layer : start.layer
  const endLayer = end.route_type === "via" ? end.from_layer : end.layer
  if (layer !== endLayer) return
  const first = pointKey({ point: start, layer })
  const last = pointKey({ point: end, layer })
  if (first === last) return
  const wire = start.route_type === "wire" ? start : end
  if (wire.route_type === "via") return
  const { start_width = wire.width, end_width = start_width } = wire
  const origin = new PlanarPoint(start.x, start.y)
  const vector = new Vector(origin, new PlanarPoint(end.x, end.y))
  const length = vector.length
  return {
    layer,
    outline: getTraceSegmentPolygon(start, end, start_width, end_width),
    origin,
    direction: vector.normalize(),
    length,
    contacts: [
      { key: first, start: 0, end: 0 },
      { key: last, start: length, end: length },
    ],
  }
}

/** Build the wires and barrel connections encoded directly in each selected route. */
function traceCopper({
  traces,
  regions,
  groups,
}: {
  traces: PcbTrace[]
  regions: CopperRegion[]
  groups: CopperGroup[]
}): CopperWire[] {
  const wires: CopperWire[] = []
  for (const { route, pcb_trace_id } of traces) {
    for (const [index, end] of route.entries()) {
      if (end.route_type === "via") {
        const keys = [end.from_layer, end.to_layer].map((layer) =>
          pointKey({ point: end, layer }),
        )
        groups.push(keys)
        if (end.outer_diameter !== undefined) {
          const outline = circlePolygon(end, end.outer_diameter / 2)
          for (const layer of [end.from_layer, end.to_layer]) {
            const key = `${pcb_trace_id}:via:${index}`
            regions.push({ layer, outline, key })
            groups.push([key, ...keys])
          }
        }
      }
      if (index === 0) continue
      const start = route[index - 1]
      if (
        start.route_type === "through_pad" ||
        end.route_type === "through_pad"
      )
        continue
      const wire = routeWire({ start, end })
      if (wire) wires.push(wire)
    }
  }
  return wires
}

/** Use only pads linked to selected PCB ports and vias associated with selected nets or routes. */
function copperRegions({
  circuit,
  ports,
  traces,
  selected,
  rails,
  traceIds,
  groups,
}: {
  circuit: CircuitJson
  ports: PcbPort[]
  traces: PcbTrace[]
  selected: ReadonlySet<string>
  rails: ReadonlySet<string>
  traceIds: ReadonlySet<NonNullable<PcbTrace["source_trace_id"]>>
  groups: CopperGroup[]
}): CopperRegion[] {
  const selectedPorts = new Map(ports.map((port) => [port.pcb_port_id, port]))
  const selectedTraces = new Set(traces.map((trace) => trace.pcb_trace_id))
  const rotations = new Map(
    circuit
      .filter((record) => record.type === "pcb_component")
      .map((record) => [record.pcb_component_id, record.rotation]),
  )
  const regions: CopperRegion[] = []
  for (const record of circuit) {
    if (record.type === "pcb_via") {
      const { source_net_id, source_trace_id, pcb_trace_id } = record
      const onNet =
        source_net_id !== undefined &&
        selected.has(source_net_id) &&
        !rails.has(source_net_id)
      const onTrace =
        source_trace_id !== undefined && traceIds.has(source_trace_id)
      const onRoute =
        pcb_trace_id !== undefined && selectedTraces.has(pcb_trace_id)
      if (!onNet && !onTrace && !onRoute) continue
      const outline = circlePolygon(record, record.outer_diameter / 2)
      for (const layer of record.layers)
        regions.push({ layer, outline, key: record.pcb_via_id })
      continue
    }
    if (record.type !== "pcb_smtpad" && record.type !== "pcb_plated_hole")
      continue
    if (record.pcb_port_id === undefined) continue
    const port = selectedPorts.get(record.pcb_port_id)
    if (!port) continue
    if (record.type === "pcb_smtpad") {
      regions.push({
        layer: record.layer,
        outline: getSmtPadPolygon(record),
        key: pointKey({ point: port, layer: record.layer }),
      })
      continue
    }
    const rotation =
      record.pcb_component_id === undefined
        ? undefined
        : rotations.get(record.pcb_component_id)
    const outline = getPlatedHolePolygon(record, rotation)
    for (const layer of record.layers)
      regions.push({ layer, outline, key: record.pcb_plated_hole_id })
    groups.push([
      record.pcb_plated_hole_id,
      ...record.layers.map((layer) => pointKey({ point: port, layer })),
    ])
  }
  return regions
}

/** Collapse overlapping contact intervals and keep the order of disjoint junctions on a wire. */
function wireJunctions({
  contacts,
  groups,
}: {
  contacts: CopperContact[]
  groups: CopperGroup[]
}): CopperGroup {
  contacts.sort((a, b) => a.start - b.start)
  const [first, ...rest] = contacts
  let current = first
  const junctions = [first.key]
  for (const contact of rest) {
    if (contact.start <= current.end + COPPER_TOLERANCE_MM) {
      groups.push([current.key, contact.key])
      if (contact.end > current.end) current = contact
      continue
    }
    junctions.push(contact.key)
    current = contact
  }
  return junctions
}

/** Add an undirected edge between two distinct copper junctions. */
export function joinCopperPoints({
  graph,
  a,
  b,
}: {
  graph: CopperGraph
  a: CopperPointKey
  b: CopperPointKey
}): void {
  if (a === b) return
  graph[a].add(b)
  graph[b].add(a)
}

/** Resolve the copper junctions and connect each pair of consecutive stops on a trace. */
export function buildRoutedCopper({
  circuit,
  ports,
  traces,
  selected,
  rails,
  traceIds,
}: {
  circuit: CircuitJson
  ports: PcbPort[]
  traces: PcbTrace[]
  selected: ReadonlySet<string>
  rails: ReadonlySet<string>
  traceIds: ReadonlySet<NonNullable<PcbTrace["source_trace_id"]>>
}): RoutedCopper {
  const groups: CopperGroup[] = []
  const regions = copperRegions({
    circuit,
    ports,
    traces,
    selected,
    rails,
    traceIds,
    groups,
  })
  const wires = traceCopper({ traces, regions, groups })
  registerOutlineContacts({ wires, regions })
  const routes = wires.map(({ contacts }) =>
    wireJunctions({ contacts, groups }),
  )
  const terminals: CopperTerminals = new Map()
  for (const port of ports) {
    const keys = port.layers.map((layer) => pointKey({ point: port, layer }))
    const existing = terminals.get(port.source_port_id)
    if (existing) existing.push(...keys)
    else terminals.set(port.source_port_id, keys)
    for (const key of keys) groups.push([key])
  }
  for (const keys of routes) {
    for (const key of keys) groups.push([key])
  }
  const networks = Object.entries(findConnectedNetworks(groups))
  const junctions = Object.fromEntries(
    networks.flatMap(([id, keys]) => keys.map((key) => [key, id])),
  )
  const graph: CopperGraph = Object.fromEntries(
    networks.map(([id]) => [id, new Set<CopperPointKey>()]),
  )
  const routed = new Set<CopperPointKey>()
  for (const keys of routes) {
    for (const [index, key] of keys.entries()) {
      const a = junctions[key]
      routed.add(a)
      if (index === 0) continue
      joinCopperPoints({ graph, a, b: junctions[keys[index - 1]] })
    }
  }
  for (const [port, keys] of terminals)
    terminals.set(
      port,
      keys.map((key) => junctions[key]),
    )
  return { graph, terminals, routed }
}
