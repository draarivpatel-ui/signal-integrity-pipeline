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
  passiveBridges,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "../connectivity"
import type { SourceNetId, SourcePortId, SourceTraceId } from "../ids"
import type { CircuitJson } from "../schema"

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
  omitted: { traces: number; vias: number; pours: number }
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
interface RetainedCopper {
  connectivity: ConnectivityMap
  retained: Set<SourcePortId | SourceNetId>
  unassociatedCopper: string[]
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
  {
    points,
    names,
    radius = 0,
  }: { points: Point[]; names: LayerRef[]; radius?: number },
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
function segmentBox(
  { a, b }: { a: PcbTraceRoutePoint; b: PcbTraceRoutePoint },
  layers: CopperLayers,
): Box {
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
  {
    sources,
    traces,
  }: { sources: Map<SourceTraceId, SourceTrace>; traces: PcbTrace[] },
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

/** Circumscribed pad boxes preserve rotation and through-hole layer spans conservatively. */
function padBox(pad: Pad, layers: CopperLayers): Box {
  if (pad.type === "pcb_smtpad" && pad.shape === "polygon")
    return copperBox({ points: pad.points, names: [pad.layer] }, layers)
  let radius = padRadius(pad)
  if (!Number.isFinite(radius)) radius = Infinity
  if (pad.type === "pcb_smtpad")
    return copperBox({ points: [pad], names: [pad.layer], radius }, layers)
  return copperBox({ points: [pad], names: pad.layers, radius }, layers)
}

/** Use the pad bounding rectangle's circumradius where there is no circular radius. */
function padRadius(pad: Pad): number {
  if (pad.type === "pcb_smtpad" && pad.shape === "circle") return pad.radius
  const width = Number(
    Reflect.get(pad, "width") ??
      Reflect.get(pad, "outer_width") ??
      Reflect.get(pad, "outer_diameter"),
  )
  const height = Number(
    Reflect.get(pad, "height") ??
      Reflect.get(pad, "outer_height") ??
      Reflect.get(pad, "outer_diameter"),
  )
  return Math.hypot(width, height) / 2
}

/** The physical copper record ID for either supported pad type. */
function padId(pad: Pad): CopperPadId {
  if (pad.type === "pcb_smtpad") return pad.pcb_smtpad_id
  return pad.pcb_plated_hole_id
}

/** Euclidean distance between bounding boxes is a lower bound on copper distance. */
function isNearby(
  candidate: Box,
  { seeds, distanceMm }: { seeds: Box[]; distanceMm: number },
): boolean {
  return seeds.some(
    (seed) =>
      candidate.lo <= seed.hi + 1 &&
      seed.lo <= candidate.hi + 1 &&
      Math.hypot(
        Math.max(0, seed.x0 - candidate.x1, candidate.x0 - seed.x1),
        Math.max(0, seed.y0 - candidate.y1, candidate.y0 - seed.y1),
      ) <= distanceMm,
  )
}

/** Retain the entire electrical net, with all branches and endpoint terminations. */
function retain(
  { ids, label }: { ids: SourceConnectionGroup; label: string },
  { connectivity, retained, unassociatedCopper }: RetainedCopper,
): void {
  if (!ids.length) unassociatedCopper.push(label)
  for (const id of ids) {
    if (retained.has(id)) continue
    for (const connected of sourceNetMembers(connectivity, id))
      retained.add(connected)
  }
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
  distanceMm = 1,
}: {
  circuit: CircuitJson
  connectivity?: ConnectivityMap
  selected: Set<SourcePortId | SourceNetId>
  reference: Set<SourcePortId | SourceNetId>
  rails?: Set<SourcePortId | SourceNetId>
  distanceMm?: number
}): CopperScope {
  const count =
    circuit.find((record) => record.type === "pcb_board")?.num_layers ?? 2
  const layers = {
    names: [
      "top",
      ...Array.from({ length: count - 2 }, (_, i) => `inner${i + 1}`),
      "bottom",
    ],
    count,
  }
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  const vias = circuit.filter((record) => record.type === "pcb_via")
  const pours = circuit.filter((record) => record.type === "pcb_copper_pour")
  const ports = new Map(
    circuit
      .filter((record) => record.type === "pcb_port")
      .map((port) => [port.pcb_port_id, port.source_port_id]),
  )
  const pads = circuit.filter(
    (record) =>
      record.type === "pcb_smtpad" || record.type === "pcb_plated_hole",
  )
  const sources = new Map(
    circuit
      .filter((record) => record.type === "source_trace")
      .map((trace) => [trace.source_trace_id, trace]),
  )
  const associations = { sources, traces }
  const boxes = new Map(
    traces.map((trace) => [
      trace.pcb_trace_id,
      trace.route
        .slice(1)
        .map((b, i) => segmentBox({ a: trace.route[i], b }, layers)),
    ]),
  )
  const selectedTraces = traces.filter((trace) =>
    traceMembers(trace.source_trace_id, sources).some((id) => selected.has(id)),
  )
  const seeds = selectedTraces.flatMap(
    (trace) => boxes.get(trace.pcb_trace_id)!,
  )
  for (const pad of pads)
    if (pad.pcb_port_id && selected.has(ports.get(pad.pcb_port_id) ?? ""))
      seeds.push(padBox(pad, layers))
  for (const via of vias)
    if (viaMembers(via, associations).some((id) => selected.has(id)))
      seeds.push(viaBox(via, layers))
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
  for (const pad of nearbyPads)
    if (pad.pcb_port_id && ports.has(pad.pcb_port_id))
      retain(
        { ids: [ports.get(pad.pcb_port_id)!], label: pad.pcb_port_id },
        retainedCopper,
      )
  const passivePorts = passiveBridges(
    circuit,
    new Set([...rails, ...reference]),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const pins of passivePorts) {
      if (!pins.some((pin) => retained.has(pin))) continue
      for (const pin of pins) {
        if (retained.has(pin)) continue
        retain({ ids: [pin], label: pin }, retainedCopper)
        changed = true
      }
    }
  }
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
  return {
    lateralDistanceMm: distanceMm,
    selectedPcbTraceIds: selectedTraces.map((trace) => trace.pcb_trace_id),
    pcbTraceIds: keptTraces.map((trace) => trace.pcb_trace_id),
    pcbViaIds: keptVias.map((via) => via.pcb_via_id),
    pcbCopperPourIds: keptPours.map((pour) => pour.pcb_copper_pour_id),
    nearbyPadIds: nearbyPads.map(padId),
    padOnlySourcePortIds: [...padOnlySourcePortIds],
    openPadIds,
    nonReferenceRailTraceIds: keptTraces
      .filter(
        (trace) =>
          traceMembers(trace.source_trace_id, sources).some((id) =>
            rails.has(id),
          ) &&
          !traceMembers(trace.source_trace_id, sources).some((id) =>
            reference.has(id),
          ),
      )
      .map((trace) => trace.pcb_trace_id),
    nearbyNonReferencePourIds: keptPours
      .filter(
        (pour) => !pour.source_net_id || !reference.has(pour.source_net_id),
      )
      .map((pour) => pour.pcb_copper_pour_id),
    unassociatedCopper,
    omitted: {
      traces: traces.length - keptTraces.length,
      vias: vias.length - keptVias.length,
      pours: pours.length - keptPours.length,
    },
    approximation: `Coupling scope: whole nets with copper within ${distanceMm} mm XY bounding-box distance on the same/adjacent copper layers of selected routes, pads or physical barrels; all connected reference pours retained. More distant nets and nonadjacent-layer coupling omitted; no field-error bound. Non-selected modelled pins use existing quiet/terminated states; unsupported neighbours fail explicitly. Pads select nets but their arbitrary shape is omitted by the routed-wire approximation, except return contacts; connected pad-only neighbours fail explicitly. ${openPadIds.length} unmapped or electrically unconnected pad bodies omitted with the existing open unused-lead approximation (no die loads or switching).`,
  }
}
