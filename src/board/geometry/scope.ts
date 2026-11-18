import type {
  LayerRef,
  PcbPlatedHole,
  PcbSmtPad,
  PcbTrace,
  PcbTraceRoutePoint,
  PcbVia,
  Point,
  SourceTrace,
} from "circuit-json"
import {
  type ConnectivityMap,
  getSourcePortConnectivityMapFromCircuitJson,
  type PassiveBridge,
  passiveBridges,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "../connectivity"
import type { SourceNetId, SourcePortId, SourceTraceId } from "../ids"
import type { CircuitJson } from "../schema"

/** Lateral search radius in millimetres when the caller supplies no admission cap. */
const DEFAULT_SCOPE_DISTANCE_MM = 1

/** A board without a layer count has only the top and bottom layers. */
const OUTER_LAYER_COUNT = 2

/** Copper can be retained one layer above or below the selected copper. */
const ADJACENT_LAYER_OFFSET = 1

export interface CopperScope {
  lateralDistanceMm: number
  selectedPcbTraceIds: string[]
  pcbTraceIds: string[]
  pcbViaIds: string[]
  pcbCopperPourIds: string[]
  nearbyPadIds: CopperPadId[]
  openPadIds: CopperPadId[]
  padOnlySourcePortIds: SourcePortId[]
  nonReferenceRailTraceIds: string[]
  nearbyNonReferencePourIds: string[]
  unassociatedCopper: string[]
  omitted: {
    traces: number
    vias: number
    pours: number
  }
  approximation: string
}

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
  lo: number
  hi: number
}
type Pad = PcbSmtPad | PcbPlatedHole

/** Record ID of a surface-mount pad or plated hole. */
type CopperPadId =
  | PcbSmtPad["pcb_smtpad_id"]
  | PcbPlatedHole["pcb_plated_hole_id"]
interface CopperLayers {
  names: string[]
  count: number
}

interface CopperBoxOptions {
  points: Point[]
  names: LayerRef[]
  radius?: number
}

interface TraceSegment {
  a: PcbTraceRoutePoint
  b: PcbTraceRoutePoint
}

interface CopperAssociations {
  sources: Map<SourceTraceId, SourceTrace>
  traces: PcbTrace[]
}

interface CopperProximity {
  seeds: Box[]
  distanceMm: number
}

interface CopperConnection {
  ids: SourceConnectionGroup
  label: string
}

interface RetainedCopper {
  connectivity: ConnectivityMap
  retained: Set<SourcePortId | SourceNetId>
  unassociatedCopper: string[]
}

interface CopperScopeOptions {
  circuit: CircuitJson
  connectivity?: ConnectivityMap
  selected: Set<SourcePortId | SourceNetId>
  reference: Set<SourcePortId | SourceNetId>
  rails?: Set<SourcePortId | SourceNetId>
  distanceMm?: number
}

/** Ports and nets associated with routing stay independent of spatial proximity. */
function traceMembers(
  id: SourceTraceId | undefined,
  sources: Map<SourceTraceId, SourceTrace>,
): SourceConnectionGroup {
  if (!id) return []
  const trace = sources.get(id)
  if (!trace) return []
  return [
    ...trace.connected_source_port_ids,
    ...(trace.connected_source_net_ids ?? []),
  ]
}

/** A conservative box; an unknown layer stays eligible on every layer. */
function copperBox(
  { points, names, radius = 0 }: CopperBoxOptions,
  layers: CopperLayers,
): Box {
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
function segmentBox({ a, b }: TraceSegment, layers: CopperLayers): Box {
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
  if (b.route_type === "via")
    return copperBox(
      { points, names: [b.from_layer, b.to_layer], radius },
      layers,
    )
  return copperBox(
    { points, names: [routeEndLayer(a), routeEndLayer(b)], radius },
    layers,
  )
}

/** Native route vias can inherit their electrical association from the PCB trace. */
function viaMembers(
  via: PcbVia,
  { sources, traces }: CopperAssociations,
): SourceConnectionGroup {
  const sourceTraceId =
    via.source_trace_id ??
    traces.find((trace) => trace.pcb_trace_id === via.pcb_trace_id)
      ?.source_trace_id
  const ids = traceMembers(sourceTraceId, sources)
  if (via.source_net_id) ids.push(via.source_net_id)
  return ids
}

/** The physical barrel span includes any inactive stubs. */
function viaBox(via: PcbVia, layers: CopperLayers): Box {
  return copperBox(
    { points: [via], names: via.layers, radius: via.outer_diameter / 2 },
    layers,
  )
}

/** Bound pad copper in board coordinates and on every layer the pad occupies. */
function padBox(pad: Pad, layers: CopperLayers): Box {
  if (pad.type === "pcb_smtpad") {
    if (pad.shape === "polygon")
      return copperBox({ points: pad.points, names: [pad.layer] }, layers)
    const radius =
      pad.shape === "circle"
        ? pad.radius
        : Math.hypot(pad.width, pad.height) / 2
    return copperBox({ points: [pad], names: [pad.layer], radius }, layers)
  }
  if (pad.shape === "hole_with_polygon_pad") {
    const angle = ((pad.ccw_rotation ?? 0) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const points = pad.pad_outline.map(({ x, y }) => ({
      x: pad.x + x * cos - y * sin,
      y: pad.y + x * sin + y * cos,
    }))
    return copperBox({ points, names: pad.layers }, layers)
  }
  return copperBox(
    { points: [pad], names: pad.layers, radius: platedPadRadius(pad) },
    layers,
  )
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

/** The physical copper record ID for either supported pad type. */
function padId(pad: Pad): CopperPadId {
  if (pad.type === "pcb_smtpad") return pad.pcb_smtpad_id
  return pad.pcb_plated_hole_id
}

/** Euclidean distance between bounding boxes is a lower bound on copper distance. */
function isNearby(
  candidate: Box,
  { seeds, distanceMm }: CopperProximity,
): boolean {
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
function retain(
  { ids, label }: CopperConnection,
  copper: RetainedCopper,
): void {
  const { connectivity, retained, unassociatedCopper } = copper
  if (!ids.length) unassociatedCopper.push(label)
  for (const id of ids) {
    if (retained.has(id)) continue
    for (const connected of sourceNetMembers(connectivity, id))
      retained.add(connected)
  }
}

/** Follow passive bridges until every port reachable from the retained nets is included. */
function retainPassiveBridges(
  bridges: PassiveBridge[],
  copper: RetainedCopper,
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const pins of bridges) {
      if (!pins.some((pin) => copper.retained.has(pin))) continue
      for (const pin of pins) {
        if (copper.retained.has(pin)) continue
        retain({ ids: [pin], label: pin }, copper)
        changed = true
      }
    }
  }
}

/** Describe what the proximity screen retains and what the routed-wire model omits. */
function scopeApproximation(distanceMm: number, openPads: number): string {
  return [
    `Coupling scope: whole nets with copper within ${distanceMm} mm XY bounding-box distance on the same/adjacent`,
    "copper layers of selected routes, pads or physical barrels; all connected reference pours retained.",
    "More distant nets and nonadjacent-layer coupling omitted; no field-error bound.",
    "Non-selected modelled pins use existing quiet/terminated states; unsupported neighbours fail explicitly.",
    "Pads select nets but their arbitrary shape is omitted by the routed-wire approximation, except return contacts;",
    "connected pad-only neighbours fail explicitly.",
    `${openPads} unmapped or electrically unconnected pad bodies omitted with the existing open unused-lead`,
    "approximation (no die loads or switching).",
  ].join(" ")
}

/**
 * Board-world XY in mm (+X right, +Y top); layers ordered top to bottom.
 * Conservative segment bounding boxes retain copper on the same/adjacent layers
 * within the caller's admission cap in XY. Entire electrically connected nets are retained.
 * Routed admission uses 32 mm unless the caller narrows it, before its solved pair screen.
 * The cap is not an electromagnetic error bound.
 */
export function channelCopperScope({
  circuit,
  connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit),
  selected,
  reference,
  rails = new Set(),
  distanceMm = DEFAULT_SCOPE_DISTANCE_MM,
}: CopperScopeOptions): CopperScope {
  const count =
    circuit.find((record) => record.type === "pcb_board")?.num_layers ??
    OUTER_LAYER_COUNT
  const innerLayers = Array.from(
    { length: count - OUTER_LAYER_COUNT },
    (_, index) => `inner${index + 1}`,
  )
  const layers = { names: ["top", ...innerLayers, "bottom"], count }
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  const vias = circuit.filter((record) => record.type === "pcb_via")
  const pours = circuit.filter((record) => record.type === "pcb_copper_pour")
  const pcbPorts = circuit.filter((record) => record.type === "pcb_port")
  const ports = new Map(
    pcbPorts.map((port) => [port.pcb_port_id, port.source_port_id]),
  )
  const pads = circuit.filter(
    (record) =>
      record.type === "pcb_smtpad" || record.type === "pcb_plated_hole",
  )
  const sourceTraces = circuit.filter(
    (record) => record.type === "source_trace",
  )
  const sources = new Map(
    sourceTraces.map((trace) => [trace.source_trace_id, trace]),
  )
  const associations = { sources, traces }
  const boxes = new Map(
    traces.map((trace) => {
      const segments = trace.route
        .slice(1)
        .map((b, i) => segmentBox({ a: trace.route[i], b }, layers))
      return [trace.pcb_trace_id, segments]
    }),
  )
  const selectedTraces = traces.filter((trace) => {
    return traceMembers(trace.source_trace_id, sources).some((id) =>
      selected.has(id),
    )
  })
  const seeds = selectedTraces.flatMap(
    (trace) => boxes.get(trace.pcb_trace_id)!,
  )
  for (const pad of pads) {
    if (!pad.pcb_port_id || !selected.has(ports.get(pad.pcb_port_id) ?? ""))
      continue
    seeds.push(padBox(pad, layers))
  }
  for (const via of vias) {
    if (!viaMembers(via, associations).some((id) => selected.has(id))) continue
    seeds.push(viaBox(via, layers))
  }
  const proximity = { seeds, distanceMm }
  const retained = new Set(selected)
  const unassociatedCopper: string[] = []
  const retainedCopper = { connectivity, retained, unassociatedCopper }
  for (const trace of traces) {
    if (!boxes.get(trace.pcb_trace_id)!.some((box) => isNearby(box, proximity)))
      continue
    retain(
      {
        ids: traceMembers(trace.source_trace_id, sources),
        label: `trace ${trace.pcb_trace_id}`,
      },
      retainedCopper,
    )
  }
  for (const via of vias) {
    if (!isNearby(viaBox(via, layers), proximity)) continue
    retain(
      { ids: viaMembers(via, associations), label: `via ${via.pcb_via_id}` },
      retainedCopper,
    )
  }
  const nearbyPads = pads.filter((pad) =>
    isNearby(padBox(pad, layers), proximity),
  )
  for (const pad of nearbyPads) {
    const portId = pad.pcb_port_id
    if (!portId || !ports.has(portId)) continue
    retain({ ids: [ports.get(portId)!], label: portId }, retainedCopper)
  }
  const passivePorts = passiveBridges(
    circuit,
    new Set([...rails, ...reference]),
  )
  retainPassiveBridges(passivePorts, retainedCopper)
  const keptTraces = traces.filter((trace) =>
    traceMembers(trace.source_trace_id, sources).some((id) => retained.has(id)),
  )
  const keptVias = vias.filter((via) =>
    viaMembers(via, associations).some(
      (id) => retained.has(id) || reference.has(id),
    ),
  )
  const keptPours = pours.filter((pour) => {
    if (pour.source_net_id && reference.has(pour.source_net_id)) return true
    if (pour.shape !== "brep") return true // Unsupported shapes cannot disappear by scoping.
    return isNearby(
      copperBox(
        { points: pour.brep_shape.outer_ring.vertices, names: [pour.layer] },
        layers,
      ),
      proximity,
    )
  })
  const padOnlySourcePortIds = new Set<SourcePortId>()
  const openPadIds: CopperPadId[] = []
  for (const pad of nearbyPads) {
    const port = pad.pcb_port_id && ports.get(pad.pcb_port_id)
    if (!port) {
      openPadIds.push(padId(pad))
      continue
    }
    if (selected.has(port) || rails.has(port) || reference.has(port)) continue
    const net = sourceNetMembers(connectivity, port)
    if (
      keptTraces.some((trace) =>
        traceMembers(trace.source_trace_id, sources).some((id) => net.has(id)),
      )
    )
      continue
    if (net.size > 1) {
      padOnlySourcePortIds.add(port)
      continue
    }
    openPadIds.push(padId(pad))
  }
  const nonReferenceRailTraces = keptTraces.filter((trace) => {
    const members = traceMembers(trace.source_trace_id, sources)
    return (
      members.some((id) => rails.has(id)) &&
      !members.some((id) => reference.has(id))
    )
  })
  const nonReferencePours = keptPours.filter(
    (pour) => !pour.source_net_id || !reference.has(pour.source_net_id),
  )
  return {
    lateralDistanceMm: distanceMm,
    selectedPcbTraceIds: selectedTraces.map((trace) => trace.pcb_trace_id),
    pcbTraceIds: keptTraces.map((trace) => trace.pcb_trace_id),
    pcbViaIds: keptVias.map((via) => via.pcb_via_id),
    pcbCopperPourIds: keptPours.map((pour) => pour.pcb_copper_pour_id),
    nearbyPadIds: nearbyPads.map(padId),
    padOnlySourcePortIds: [...padOnlySourcePortIds],
    openPadIds,
    nonReferenceRailTraceIds: nonReferenceRailTraces.map(
      (trace) => trace.pcb_trace_id,
    ),
    nearbyNonReferencePourIds: nonReferencePours.map(
      (pour) => pour.pcb_copper_pour_id,
    ),
    unassociatedCopper,
    omitted: {
      traces: traces.length - keptTraces.length,
      vias: vias.length - keptVias.length,
      pours: pours.length - keptPours.length,
    },
    approximation: scopeApproximation(distanceMm, openPadIds.length),
  }
}
