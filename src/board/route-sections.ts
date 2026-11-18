import type { PcbPort } from "circuit-json"
import { polygonContains } from "./geometry/polygon"
import { resolveRouteVias } from "./geometry/ports"
import type { CopperScope } from "./geometry/scope"
import type { PcbTrace, RoutedPoint } from "./geometry/types"
import type { SourceTraceId } from "./ids"
import {
  chordDistance,
  projectRouteWire,
  simplifyRouteWires,
} from "./route-simplify"
import { unionRouteWires } from "./route-union"
import type { CircuitJson, LayerRef } from "./schema"
import { type BoardStackup, stackupFromCircuitJson } from "./stackup"

/** Millimeter tolerance for matching ports, wire ends, via contacts and lateral joins. */
const CONTACT_TOLERANCE_MM = 1e-5

/** Bounding distance for replacing a missing vertical reference with the nearest pour edge. */
const MAX_REFERENCE_EDGE_DISTANCE_MM = 2

/** Parallel centre lines have a near-zero intersection denominator. */
const PARALLEL_TOLERANCE = 1e-10

/** Ignore degenerate route segments and cuts that already coincide with their ends. */
const MIN_WIRE_LENGTH_MM = 1e-7

/** Ignore negligible slice intervals and join contiguous intervals within the same tolerance. */
const SLICE_TOLERANCE_MM = 1e-6

/** Round direction and position keys before grouping or deduplicating values. */
const KEY_DECIMAL_PLACES = 7

/** Maximum chord deviation when simplifying tessellated route curves. */
const CHORD_TOLERANCE_MM = 0.001

export type RouteXY = [number, number]

interface RouteJoin {
  from: RouteXY
  to: RouteXY
  source: SourceTraceId
  trace: PcbTrace["pcb_trace_id"]
}

export interface RouteWire {
  id: number
  trace: PcbTrace["pcb_trace_id"]
  source: SourceTraceId
  layer: string
  width: number
  joins?: RouteJoin[]
  aPort?: boolean
  bPort?: boolean
  a: RouteXY
  b: RouteXY
  u: RouteXY
  start: number
  end: number
  transverse: number
}

export interface RouteReference {
  id: string
  net: string
  layer: string
  z: number
  lateralGapMm?: number
}

export interface RouteSlice {
  wires: RouteWire[]
  start: number
  end: number
  references: RouteReference[]
}

interface ViaContact {
  trace: PcbTrace["pcb_trace_id"]
  layer: string
  point: RouteXY
}

interface RoutePour {
  id: string
  net: string
  layer: string
  polygon: RouteXY[][]
}

export interface SectionGeometry {
  viaContacts: ViaContact[]
  stack: BoardStackup
  wires: RouteWire[]
  slices: RouteSlice[]
  pours: RoutePour[]
  warnings: string[]
}

/** Canonical projection in mm; route direction is retained in the physical endpoints. */
export function routePosition(wire: RouteWire, position: number): RouteXY {
  return [
    wire.u[0] * position - wire.u[1] * wire.transverse,
    wire.u[1] * position + wire.u[0] * wire.transverse,
  ]
}

/** Check whether two physical contact positions coincide within the route tolerance. */
function sameContact(a: RouteXY, b: RouteXY): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < CONTACT_TOLERANCE_MM
}

/** Port contact requires the same layer as well as the same position. */
function portTouches(
  port: PcbPort,
  {
    layer,
    point,
  }: {
    layer: string
    point: RouteXY
  },
): boolean {
  return (
    port.layers.includes(layer as LayerRef) &&
    sameContact([port.x, port.y], point)
  )
}

/** Local frame at actual routed copper, including via-in-pad contacts without a planar segment. */
export function routeContactFrame({
  geometry,
  scope,
  layer,
  point,
}: {
  geometry: SectionGeometry
  scope: CopperScope
  layer: string
  point: RouteXY
}): RouteWire | undefined {
  const direct = geometry.wires.find((wire) => {
    if (
      scope.nonReferenceRailTraceIds.includes(wire.trace) ||
      wire.layer !== layer
    )
      return false
    const joins = wire.joins?.map((join) => join.from) ?? []
    return [wire.a, wire.b, ...joins].some((endpoint) =>
      sameContact(endpoint, point),
    )
  })
  if (direct) return direct
  const contact = geometry.viaContacts.find((contact) => {
    if (
      scope.nonReferenceRailTraceIds.includes(contact.trace) ||
      contact.layer !== layer
    )
      return false
    return sameContact(contact.point, point)
  })
  if (!contact) return undefined
  const wire = geometry.wires.find((wire) => wire.trace === contact.trace)
  if (!wire) return undefined
  return { ...wire, layer }
}

/** Distance from a projected wire position to the nearest polygon edge. */
function pourEdgeGap(point: RouteXY, polygon: RouteXY[][]): number {
  const distances = polygon.flatMap((ring) =>
    ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length]
      return chordDistance({ point, a, b })
    }),
  )
  return Math.min(...distances)
}

/** Nearest actual pour surface in each vertical direction, including intervening power copper. */
export function routeReferences({
  geometry,
  wire,
  position,
}: {
  geometry: Pick<SectionGeometry, "stack" | "pours">
  wire: RouteWire
  position: number
}): RouteReference[] {
  const point = routePosition(wire, position)
  const signal = geometry.stack.copperLayers.find(
    (layer) => layer.name === wire.layer,
  )!
  const otherLayers = geometry.pours.filter((pour) => pour.layer !== wire.layer)
  const intersecting = otherLayers.filter((pour) =>
    polygonContains(point, pour.polygon),
  )
  const candidates = intersecting.map((pour) => {
    const layer = geometry.stack.copperLayers.find(
      (layer) => layer.name === pour.layer,
    )!
    const reference = { id: pour.id, net: pour.net, layer: pour.layer }
    if (layer.zMinMm > signal.zMaxMm) return { ...reference, z: layer.zMinMm }
    return { ...reference, z: layer.zMaxMm }
  })
  const [below] = candidates
    .filter((plane) => plane.z <= signal.zMinMm)
    .sort((a, b) => b.z - a.z)
  const [above] = candidates
    .filter((plane) => plane.z >= signal.zMaxMm)
    .sort((a, b) => a.z - b.z)
  const actual = [below, above].filter(
    (plane): plane is RouteReference => plane !== undefined,
  )
  if (actual.length) return actual

  // Use the nearest actual edge as an explicit quasi-static fringing and return-detour estimate.
  const edges = otherLayers
    .map((pour) => {
      const gap = pourEdgeGap(point, pour.polygon)
      const layer = geometry.stack.copperLayers.find(
        (layer) => layer.name === pour.layer,
      )!
      const reference = { id: pour.id, net: pour.net, layer: pour.layer }
      const aboveSignal = layer.zMinMm > signal.zMaxMm
      let verticalGap = layer.zMaxMm - signal.zMinMm
      if (aboveSignal) verticalGap = layer.zMinMm - signal.zMaxMm
      const distance = Math.hypot(verticalGap, gap)
      let z = signal.zMinMm - distance
      if (aboveSignal) z = signal.zMaxMm + distance
      return {
        ...reference,
        z,
        lateralGapMm: gap,
        distance,
      }
    })
    .sort((a, b) => a.distance - b.distance)
  if (edges.length && edges[0].distance < MAX_REFERENCE_EDGE_DISTANCE_MM)
    return [edges[0]]
  return []
}

/** Centre-line intersections with every pour boundary/cutout; no sampling can jump over a narrow void. */
function referenceCuts(wire: RouteWire, geometry: SectionGeometry): number[] {
  const cuts: number[] = []
  for (const pour of geometry.pours) {
    for (const ring of pour.polygon) {
      for (const [i, a] of ring.entries()) {
        const b = ring[(i + 1) % ring.length]
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const denominator = dx * wire.u[1] - dy * wire.u[0]
        if (Math.abs(denominator) < PARALLEL_TOLERANCE) continue
        const t =
          (-wire.transverse - a[0] * wire.u[1] + a[1] * wire.u[0]) / denominator
        if (!(t > 0 && t < 1)) continue
        const s = (a[0] + t * dx) * wire.u[0] + (a[1] + t * dy) * wire.u[1]
        if (
          s > wire.start + MIN_WIRE_LENGTH_MM &&
          s < wire.end - MIN_WIRE_LENGTH_MM
        )
          cuts.push(s)
      }
    }
  }
  return cuts
}

/** Layer after leaving a physical route point. */
function routedLayer(point: RoutedPoint): LayerRef {
  if (point.route_type === "via") return point.to_layer
  return point.layer
}

/** Record via contacts and straight wire sections for one physical route. */
function appendRoute(
  geometry: SectionGeometry,
  {
    circuit,
    trace,
  }: {
    circuit: CircuitJson
    trace: PcbTrace
  },
): void {
  const route = resolveRouteVias(circuit, trace)
  for (const via of route.filter((point) => point.route_type === "via")) {
    for (const layer of [via.from_layer, via.to_layer]) {
      geometry.viaContacts.push({
        trace: trace.pcb_trace_id,
        layer,
        point: [via.x, via.y],
      })
    }
  }
  for (const [i, b] of route.entries()) {
    if (!i || b.route_type !== "wire") continue
    const a = route[i - 1]
    const layer = routedLayer(a)
    if (layer !== b.layer)
      throw new Error(
        `${trace.pcb_trace_id}: layer changes require explicit vias`,
      )
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < MIN_WIRE_LENGTH_MM) continue
    if (b.start_width !== undefined || b.end_width !== undefined) {
      throw new Error(
        `${trace.pcb_trace_id}: tapered routes need explicit width sections`,
      )
    }
    const start: RouteXY = [a.x, a.y]
    const end: RouteXY = [b.x, b.y]
    geometry.wires.push({
      id: geometry.wires.length,
      trace: trace.pcb_trace_id,
      source: trace.source_trace_id!,
      layer,
      width: b.width,
      a: start,
      b: end,
      ...projectRouteWire({ a: start, b: end, length }),
    })
  }
}

type WireDirectionKey = string
type ReferenceProfileKey = string
type RouteSliceKey = string

/** Wires that share a reference profile within a longitudinal interval. */
type ReferenceRegion = Pick<RouteSlice, "wires" | "references">

/** Collect slices in which wires have the same direction and share a reference profile. */
function sliceParallelRoutes(
  geometry: SectionGeometry,
  scope: CopperScope,
): void {
  const groups = new Map<WireDirectionKey, RouteWire[]>()
  for (const wire of geometry.wires) {
    const key = wire.u.map((n) => n.toFixed(KEY_DECIMAL_PLACES)).join(",")
    groups.set(key, [...(groups.get(key) ?? []), wire])
  }
  for (const wires of groups.values()) {
    const positions = wires.flatMap((wire) => [
      wire.start,
      wire.end,
      ...referenceCuts(wire, geometry),
    ])
    const rounded = positions.map((position) =>
      Number(position.toFixed(KEY_DECIMAL_PLACES)),
    )
    const cuts = [...new Set(rounded)].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1]
      const end = cuts[i]
      if (end - start < SLICE_TOLERANCE_MM) continue
      const middle = (start + end) / 2
      const active = wires.filter(
        (wire) => wire.start < middle && wire.end > middle,
      )
      const regions = new Map<ReferenceProfileKey, ReferenceRegion>()
      for (const wire of active) {
        const references = routeReferences({ geometry, wire, position: middle })
        if (
          !references.length &&
          scope.nonReferenceRailTraceIds.includes(wire.trace)
        )
          continue
        if (!references.length) {
          throw new Error(
            `${wire.trace} ${wire.layer} at ${routePosition(wire, middle)}: no actual reference pour`,
          )
        }
        const key = references
          .map((plane) => {
            return `${plane.layer}:${plane.net}:${plane.z.toFixed(KEY_DECIMAL_PLACES)}`
          })
          .join("/")
        const region = regions.get(key) ?? { wires: [], references }
        region.wires.push(wire)
        regions.set(key, region)
      }
      for (const region of regions.values()) {
        sliceRegion(
          {
            ...region,
            start,
            end,
            scope,
          },
          geometry.slices,
        )
      }
    }
  }
}

/** Sweep exact parallel directions, partitioning at route ends, widths, layers and actual pour holes. */
export function* routeSectionSteps(
  circuit: CircuitJson,
  scope: CopperScope,
): Generator<SectionGeometry, SectionGeometry> {
  const geometry: SectionGeometry = {
    viaContacts: [],
    stack: stackupFromCircuitJson(circuit),
    wires: [],
    slices: [],
    pours: [],
    warnings: [],
  }
  geometry.pours = circuit
    .filter((record) => record.type === "pcb_copper_pour")
    .flatMap((pour) => {
      if (pour.shape !== "brep")
        throw new Error(
          `${pour.pcb_copper_pour_id}: 2D route extraction needs polygonal pours`,
        )
      const rings = [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings]
      return [
        {
          id: pour.pcb_copper_pour_id,
          net: pour.source_net_id ?? "unassociated",
          layer: pour.layer,
          polygon: rings.map((ring) =>
            ring.vertices.map((p) => [p.x, p.y] as RouteXY),
          ),
        },
      ]
    })
  // Rail traces are retained as AC-ground electrodes by the extraction caller; they need no longitudinal dynamics.
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  for (const trace of traces) {
    if (!scope.pcbTraceIds.includes(trace.pcb_trace_id)) continue
    appendRoute(geometry, { circuit, trace })
    yield geometry
  }
  const simplified = simplifyRouteWires(geometry.wires, CHORD_TOLERANCE_MM)
  geometry.warnings.push(
    [
      `Curved route tessellation reduced with ${CHORD_TOLERANCE_MM} mm chord tolerance:`,
      `${geometry.wires.length} to ${simplified.wires.length} wires;`,
      `total length ${simplified.originalLengthMm} to ${simplified.simplifiedLengthMm} mm.`,
      "Original board bytes unchanged.",
    ].join(" "),
  )
  geometry.wires = unionRouteWires(simplified.wires, circuit)
  geometry.warnings.push(
    [
      "Overlapping parallel same-net copper is unioned into its exact transverse rectangle, split at patch ends.",
      "Lateral joins are equipotential breakout approximations; lateral spreading R/L and edge fringing are omitted.",
      "Original endpoints and joins are recorded.",
    ].join(" "),
  )
  const ports = circuit.filter((record) => record.type === "pcb_port")
  for (const wire of geometry.wires) {
    wire.aPort = ports.some((port) =>
      portTouches(port, { layer: wire.layer, point: wire.a }),
    )
    wire.bPort = ports.some((port) =>
      portTouches(port, { layer: wire.layer, point: wire.b }),
    )
  }
  sliceParallelRoutes(geometry, scope)
  geometry.slices = mergeSlices(geometry.slices)
  geometry.warnings.push(
    [
      "Reference boundaries use centre-line polygon intersections; lateral fringing across plane edges/voids uses",
      "a local infinite-plane approximation, with no 3D edge-field accuracy claim.",
    ].join(" "),
    [
      "Where all vertical references are void, the nearest actual pour edge",
      `within ${MAX_REFERENCE_EDGE_DISTANCE_MM} mm`,
      "is replaced by a surface at hypotenuse(vertical gap, lateral edge distance);",
      "lateralGapMm marks every such approximation.",
    ].join(" "),
    [
      "Different parallel directions are separate sweeps; oblique encounters receive a bounded electrostatic lumped",
      "correction, with magnetic oblique coupling omitted explicitly.",
    ].join(" "),
  )
  return geometry
}

/** Split a region at lateral gaps and keep groups with at least one signal wire. */
function sliceRegion(
  { wires, references, start, end, scope }: RouteSlice & { scope: CopperScope },
  slices: RouteSlice[],
): void {
  const ordered = wires.sort((a, b) => a.transverse - b.transverse)
  const railTraces = scope.nonReferenceRailTraceIds
  let group: RouteWire[] = []
  for (const wire of ordered) {
    const last = group.at(-1)
    if (last) {
      const gap =
        wire.transverse - last.transverse - (wire.width + last.width) / 2
      if (gap > scope.lateralDistanceMm) {
        if (group.some((wire) => !railTraces.includes(wire.trace))) {
          slices.push({
            wires: group,
            start,
            end,
            references,
          })
        }
        group = []
      }
    }
    group.push(wire)
  }
  if (group.some((wire) => !railTraces.includes(wire.trace))) {
    slices.push({
      wires: group,
      start,
      end,
      references,
    })
  }
}

/** Merge consecutive slices that have the same wires and references. */
function mergeSlices(slices: RouteSlice[]): RouteSlice[] {
  const merged: RouteSlice[] = []
  const previous = new Map<RouteSliceKey, RouteSlice>()
  for (const slice of slices) {
    const key = JSON.stringify([
      slice.wires.map((wire) => wire.id),
      slice.references,
    ])
    const last = previous.get(key)
    if (last && Math.abs(last.end - slice.start) < SLICE_TOLERANCE_MM) {
      last.end = slice.end
      continue
    }
    merged.push(slice)
    previous.set(key, slice)
  }
  return merged
}

/** Drain the same segmentation algorithm for domain callers that do not need stepping. */
export function segmentRoutes(
  circuit: CircuitJson,
  scope: CopperScope,
): SectionGeometry {
  const steps = routeSectionSteps(circuit, scope)
  let result = steps.next()
  while (!result.done) result = steps.next()
  return result.value
}
