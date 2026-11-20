import type {
  LayerRef,
  PcbPlatedHole,
  PcbSmtPad,
  PcbTrace,
  PcbTraceRoutePoint,
  PcbVia,
  Point,
  PointWithBulge,
  SourceTrace,
} from "circuit-json"
import {
  type ConnectivityMap,
  type PassiveBridge,
  passiveBridges,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "../connectivity"
import { fail } from "../diagnostics"
import type {
  PcbPortId,
  PcbTraceId,
  PcbViaId,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "../ids"
import type { CircuitJson } from "../schema"

/** Degrees in half a turn, for converting pad rotation to radians. */
const DEGREES_PER_HALF_TURN = 180

/** The bulge is the tangent of one quarter of a signed circular arc's sweep. */
const ARC_SWEEP_QUARTERS = 4

/** Number of outer copper layers, top and bottom. */
const OUTER_LAYER_COUNT = 2

/** Copper can be retained one layer above or below the selected copper. */
const ADJACENT_LAYER_OFFSET = 1

/** Counts used to report the scope's effect on routed copper. */
interface OmittedCopper {
  traces: number
}

/** Copper and electrical nets kept by the channel proximity screen. */
export interface CopperScope {
  lateralDistanceMm: number
  selectedPcbTraceIds: PcbTraceId[]
  pcbTraceIds: PcbTraceId[]
  pcbViaIds: PcbViaId[]
  nonReferenceRailTraceIds: PcbTraceId[]
  omitted: OmittedCopper
  retainedSourceIds: SourceConnectionGroup
}

/** Bounds in board millimetres and the inclusive span of occupied layer indices. */
interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
  lo: number
  hi: number
}
/** Board layer names in stack order and the layer count used for bounds. */
interface CopperLayers {
  names: string[]
  count: number
}

interface CopperBoxOptions {
  layers: CopperLayers
  points: Point[]
  names: LayerRef[]
  radius?: number
}

type Pad = PcbSmtPad | PcbPlatedHole

/** Bounding boxes associated with one PCB trace record. */
type TraceBoxes = [traceId: PcbTraceId, boxes: Box[]]

interface CopperAssociations {
  sources: Map<SourceTraceId, SourceTrace>
  traces: PcbTrace[]
}

interface CopperProximity {
  seeds: Box[]
  distanceMm: number
}

interface RetainedCopper {
  connectivity: ConnectivityMap
  retained: Set<SourcePortId | SourceNetId>
}

interface CopperScopeOptions {
  circuit: CircuitJson
  connectivity: ConnectivityMap
  selected: ReadonlySet<SourcePortId | SourceNetId>
  reference: ReadonlySet<SourcePortId | SourceNetId>
  rails: ReadonlySet<SourcePortId | SourceNetId>
  distanceMm: number
}

/** Ports and nets associated with routing stay independent of spatial proximity. */
function traceMembers({
  id,
  sources,
}: {
  id: SourceTraceId | undefined
  sources: Map<SourceTraceId, SourceTrace>
}): SourceConnectionGroup {
  if (!id) return []
  const trace = sources.get(id)
  if (!trace) return []
  return [
    ...trace.connected_source_port_ids,
    ...(trace.connected_source_net_ids ?? []),
  ]
}

/** A conservative box; an unknown layer stays eligible on every layer. */
function copperBox({
  points,
  names,
  layers,
  radius = 0,
}: CopperBoxOptions): Box {
  const indices = names.map((name) => layers.names.indexOf(name))
  const box = {
    x0: Math.min(...points.map((p) => p.x)) - radius,
    x1: Math.max(...points.map((p) => p.x)) + radius,
    y0: Math.min(...points.map((p) => p.y)) - radius,
    y1: Math.max(...points.map((p) => p.y)) + radius,
  }
  if (indices.some((i) => i < 0)) return { ...box, lo: 0, hi: layers.count - 1 }
  return { ...box, lo: Math.min(...indices), hi: Math.max(...indices) }
}

/** The layer where a route point leaves copper. */
function routeEndLayer(point: PcbTraceRoutePoint): LayerRef {
  if (point.route_type === "via") return point.to_layer
  if (point.route_type === "wire") return point.layer
  return point.end_layer
}

/** Bound the copper covered by one wire, pad or via segment. */
function segmentBox({
  a,
  b,
  layers,
}: {
  a: PcbTraceRoutePoint
  b: PcbTraceRoutePoint
  layers: CopperLayers
}): Box {
  const points = [a, b].flatMap((point) => {
    if (point.route_type === "through_pad") return [point.start, point.end]
    return [point]
  })
  const radius = Math.max(
    ...[a, b].map((point) => {
      if (point.route_type === "wire") return point.width / 2
      return 0
    }),
  )
  if (b.route_type !== "via") {
    return copperBox({
      points,
      names: [routeEndLayer(a), routeEndLayer(b)],
      radius,
      layers,
    })
  }
  const names = [b.from_layer]
  if (a.route_type === "through_pad")
    return copperBox({ points: [a.end, b], names, radius, layers })
  return copperBox({ points: [a, b], names, radius, layers })
}

/** Native route vias can inherit their electrical association from the PCB trace. */
function viaMembers({
  via,
  associations,
}: {
  via: PcbVia
  associations: CopperAssociations
}): SourceConnectionGroup {
  const { sources, traces } = associations
  const sourceTraceId =
    via.source_trace_id ??
    traces.find((trace) => trace.pcb_trace_id === via.pcb_trace_id)
      ?.source_trace_id
  const ids = traceMembers({ id: sourceTraceId, sources })
  if (via.source_net_id) ids.push(via.source_net_id)
  return ids
}

/** The physical barrel span includes any inactive stubs. */
function viaBox({ via, layers }: { via: PcbVia; layers: CopperLayers }): Box {
  const { topmost_drill_layer: top, bottommost_drill_layer: bottom } = via
  const drillLayers = [top, bottom].filter((layer) => layer !== undefined)
  const radius = via.outer_diameter / 2
  if (top !== undefined && bottom !== undefined)
    return copperBox({ points: [via], names: drillLayers, radius, layers })
  return copperBox({
    points: [via],
    names: [...via.layers, ...drillLayers],
    radius,
    layers,
  })
}

/** Bound surface-mount pad copper around its outline or circumradius. */
function smtPadBox({
  pad,
  layers,
}: {
  pad: PcbSmtPad
  layers: CopperLayers
}): Box {
  const names = [pad.layer]
  if (pad.shape === "polygon")
    return copperBox({ points: pad.points, names, layers })
  if (pad.shape === "circle")
    return copperBox({ points: [pad], names, radius: pad.radius, layers })
  const radius = Math.hypot(pad.width, pad.height) / 2
  return copperBox({ points: [pad], names, radius, layers })
}

/** Bound pad copper in board coordinates and on every layer the pad occupies. */
function padBox({ pad, layers }: { pad: Pad; layers: CopperLayers }): Box {
  if (pad.type === "pcb_smtpad") return smtPadBox({ pad, layers })
  if (pad.shape === "hole_with_polygon_pad") {
    const angle = ((pad.ccw_rotation ?? 0) * Math.PI) / DEGREES_PER_HALF_TURN
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const points = pad.pad_outline.map(({ x, y }) => ({
      x: pad.x + x * cos - y * sin,
      y: pad.y + x * sin + y * cos,
    }))
    return copperBox({ points, names: pad.layers, layers })
  }
  return copperBox({
    points: [pad],
    names: pad.layers,
    radius: platedPadRadius(pad),
    layers,
  })
}

/** The circumradius preserves the bounds of copper pads at any rotation. */
function platedPadRadius(
  pad: Exclude<PcbPlatedHole, { shape: "hole_with_polygon_pad" }>,
): number {
  if (pad.shape === "circle") return pad.outer_diameter / 2
  if ("rect_pad_width" in pad)
    return Math.hypot(pad.rect_pad_width, pad.rect_pad_height) / 2
  return Math.hypot(pad.outer_width, pad.outer_height) / 2
}

/** Return the axis extrema that the signed circular arc actually crosses. */
function arcExtrema({
  start,
  end,
}: {
  start: PointWithBulge
  end: Point
}): Point[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const bulge = start.bulge
  if (!bulge || (dx === 0 && dy === 0)) return []

  const sweep = ARC_SWEEP_QUARTERS * Math.atan(bulge)
  const offset = (1 / bulge - bulge) / ARC_SWEEP_QUARTERS
  const cx = (start.x + end.x) / 2 - dy * offset
  const cy = (start.y + end.y) / 2 + dx * offset
  const startAngle = Math.atan2(start.y - cy, start.x - cx)
  const radius = Math.hypot(start.x - cx, start.y - cy)
  const turn = 2 * Math.PI
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ]
  return directions.flatMap(({ x, y }) => {
    const angle = (Math.atan2(y, x) - startAngle) * Math.sign(sweep)
    if ((angle + turn) % turn > Math.abs(sweep)) return []
    return [{ x: cx + radius * x, y: cy + radius * y }]
  })
}

/** Euclidean distance between bounding boxes is a lower bound on copper distance. */
function isNearby({
  candidate,
  proximity,
}: {
  candidate: Box
  proximity: CopperProximity
}): boolean {
  const { seeds, distanceMm } = proximity
  return seeds.some((seed) => {
    const adjacentLayers =
      candidate.lo <= seed.hi + ADJACENT_LAYER_OFFSET &&
      seed.lo <= candidate.hi + ADJACENT_LAYER_OFFSET
    if (!adjacentLayers) return false

    const xGap = Math.max(0, seed.x0 - candidate.x1, candidate.x0 - seed.x1)
    const yGap = Math.max(0, seed.y0 - candidate.y1, candidate.y0 - seed.y1)
    return Math.hypot(xGap, yGap) <= distanceMm
  })
}

/** Retain the entire electrical net, with all branches and endpoint terminations. */
function retain({
  ids,
  copper,
}: {
  ids: SourceConnectionGroup
  copper: RetainedCopper
}): void {
  const { connectivity, retained } = copper
  for (const id of ids) {
    if (retained.has(id)) continue
    for (const connected of sourceNetMembers({ connectivity, seed: id }))
      retained.add(connected)
  }
}

/** Follow passive bridges until every port reachable from the retained nets is included. */
function retainPassiveBridges({
  bridges,
  copper,
}: {
  bridges: PassiveBridge[]
  copper: RetainedCopper
}): void {
  let changed = true
  while (changed) {
    changed = false
    for (const pins of bridges) {
      if (!pins.some((pin) => copper.retained.has(pin))) continue
      for (const pin of pins) {
        if (copper.retained.has(pin)) continue
        retain({ ids: [pin], copper })
        changed = true
      }
    }
  }
}

/**
 * Board-world XY in mm (+X right, +Y top); layers ordered top to bottom.
 * Conservative segment bounding boxes retain copper on the same/adjacent layers
 * within the caller's admission cap in XY. Entire electrically connected nets are retained.
 * The cap is not an electromagnetic error bound.
 */
export function channelCopperScope({
  circuit,
  connectivity,
  selected,
  reference,
  rails,
  distanceMm,
}: CopperScopeOptions): CopperScope {
  if (!Number.isFinite(distanceMm) || distanceMm < 0) {
    fail(
      "simulation_scope",
      "Copper scope distance must be finite and non-negative",
    )
  }
  const count = circuit.find(
    (record) => record.type === "pcb_board",
  )!.num_layers
  const innerLayers = Array.from(
    { length: count - OUTER_LAYER_COUNT },
    (_, index) => `inner${index + 1}`,
  )
  const layers = { names: ["top", ...innerLayers, "bottom"], count }
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  const vias = circuit.filter((record) => record.type === "pcb_via")
  const pours = circuit.filter((record) => record.type === "pcb_copper_pour")
  const pcbPorts = circuit.filter((record) => record.type === "pcb_port")
  const ports = new Map<PcbPortId, SourcePortId>(
    pcbPorts.map((port) => [port.pcb_port_id, port.source_port_id]),
  )
  const pads = circuit.filter(
    (record) =>
      record.type === "pcb_smtpad" || record.type === "pcb_plated_hole",
  )
  const sourceTraces = circuit.filter(
    (record) => record.type === "source_trace",
  )
  const sources = new Map<SourceTraceId, SourceTrace>(
    sourceTraces.map((trace) => [trace.source_trace_id, trace]),
  )
  const associations = { sources, traces }
  const boxes = new Map<PcbTraceId, Box[]>(
    traces.map((trace): TraceBoxes => {
      const segments = trace.route
        .slice(1)
        .map((b, i) => segmentBox({ a: trace.route[i], b, layers }))
      for (const point of trace.route) {
        if (point.route_type !== "via") continue
        const radius = (point.outer_diameter ?? 0) / 2
        segments.push(
          copperBox({
            points: [point],
            names: [point.from_layer, point.to_layer],
            radius,
            layers,
          }),
        )
      }
      return [trace.pcb_trace_id, segments]
    }),
  )
  const selectedTraces = traces.filter((trace) => {
    return traceMembers({ id: trace.source_trace_id, sources }).some((id) =>
      selected.has(id),
    )
  })
  const seeds = selectedTraces.flatMap(
    (trace) => boxes.get(trace.pcb_trace_id)!,
  )
  for (const pad of pads) {
    const sourcePort = pad.pcb_port_id && ports.get(pad.pcb_port_id)
    if (!sourcePort || !selected.has(sourcePort)) continue
    seeds.push(padBox({ pad, layers }))
  }
  for (const via of vias) {
    if (!viaMembers({ via, associations }).some((id) => selected.has(id)))
      continue
    seeds.push(viaBox({ via, layers }))
  }
  const proximity = { seeds, distanceMm }
  const retained = new Set(selected)
  const retainedCopper = { connectivity, retained }
  for (const trace of traces) {
    if (
      !boxes
        .get(trace.pcb_trace_id)!
        .some((box) => isNearby({ candidate: box, proximity }))
    )
      continue
    const ids = traceMembers({ id: trace.source_trace_id, sources })
    retain({ ids, copper: retainedCopper })
  }
  for (const via of vias) {
    if (!isNearby({ candidate: viaBox({ via, layers }), proximity })) continue
    const ids = viaMembers({ via, associations })
    retain({ ids, copper: retainedCopper })
  }
  for (const pad of pads) {
    const port = pad.pcb_port_id && ports.get(pad.pcb_port_id)
    if (!port || !isNearby({ candidate: padBox({ pad, layers }), proximity }))
      continue
    retain({ ids: [port], copper: retainedCopper })
  }
  for (const pour of pours) {
    const id = pour.source_net_id
    if (!id || reference.has(id) || pour.shape !== "brep") continue
    const { vertices } = pour.brep_shape.outer_ring
    const points = vertices.flatMap((start, i) => {
      const end = vertices[(i + 1) % vertices.length]
      return [start, ...arcExtrema({ start, end })]
    })
    const box = copperBox({ points, names: [pour.layer], layers })
    if (isNearby({ candidate: box, proximity }))
      retain({ ids: [id], copper: retainedCopper })
  }
  const bridges = passiveBridges({
    circuit,
    excluded: new Set([...rails, ...reference]),
  })
  retainPassiveBridges({ bridges, copper: retainedCopper })
  const keptTraces = traces.filter((trace) => {
    return traceMembers({ id: trace.source_trace_id, sources }).some((id) =>
      retained.has(id),
    )
  })
  const keptVias = vias.filter((via) => {
    return viaMembers({ via, associations }).some(
      (id) => retained.has(id) || reference.has(id),
    )
  })
  const nonReferenceRailTraces = keptTraces.filter((trace) => {
    const members = traceMembers({ id: trace.source_trace_id, sources })
    return (
      members.some((id) => rails.has(id)) &&
      !members.some((id) => reference.has(id))
    )
  })
  return {
    lateralDistanceMm: distanceMm,
    selectedPcbTraceIds: selectedTraces.map((trace) => trace.pcb_trace_id),
    pcbTraceIds: keptTraces.map((trace) => trace.pcb_trace_id),
    pcbViaIds: keptVias.map((via) => via.pcb_via_id),
    nonReferenceRailTraceIds: nonReferenceRailTraces.map(
      (trace) => trace.pcb_trace_id,
    ),
    omitted: { traces: traces.length - keptTraces.length },
    retainedSourceIds: [...retained],
  }
}
