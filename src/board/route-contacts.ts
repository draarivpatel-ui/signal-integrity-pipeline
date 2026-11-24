import { Point, type Polygon } from "@flatten-js/core"
import {
  circlePolygon,
  cju,
  copperPolygonsTouch,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import type { PcbPort, PcbVia } from "circuit-json"
import { hypotenuse, type Snapshot } from "../kernel"
import { getSourcePortConnectivityMapFromCircuitJson } from "./connectivity"
import type { CopperScope } from "./geometry/scope"
import type { CopperPoint } from "./geometry/types"
import type { PcbPortId } from "./ids"
import type {
  RoutePortContact,
  RouteVia,
  RouteWire,
  SectionGeometry,
} from "./route-section-types"
import type { CircuitJson, LayerRef } from "./schema"

/** Physical outlines and point contacts use the same tolerance as topology validation. */
const CONTACT_TOLERANCE_MM = 1e-5

/** A pad outline in contact with zero or more planar conductors. */
interface PortOutline {
  pcbPort: PcbPort
  layer: LayerRef
  outline: Polygon
}

/** Wire and occupied area on its copper layer. */
interface WireOutline {
  wire: RouteWire
  outline: Polygon
}

/** Resolved contacts on real PCB ports and tagged wire endpoints. */
type RouteContacts = Pick<SectionGeometry, "wires" | "portContacts">

/** Compare physical endpoints on the copper geometry precision grid. */
function arePointsCoincident({
  first,
  second,
}: {
  first: Snapshot<CopperPoint>
  second: Snapshot<CopperPoint>
}): boolean {
  return (
    hypotenuse(first[0] - second[0], first[1] - second[1]) <
    CONTACT_TOLERANCE_MM
  )
}

/** Read physical pads and plated holes connected to PCB ports. */
function getPortOutlines(circuit: CircuitJson): PortOutline[] {
  const db = cju([...circuit])
  const smtPads = db.pcb_smtpad.list().flatMap((pad): PortOutline[] => {
    if (pad.pcb_port_id === undefined) return []
    const pcbPort = db.pcb_port.get(pad.pcb_port_id)
    if (!pcbPort) return []
    return [{ pcbPort, layer: pad.layer, outline: getSmtPadPolygon(pad) }]
  })
  const platedHoles = db.pcb_plated_hole
    .list()
    .flatMap((hole): PortOutline[] => {
      if (hole.pcb_port_id === undefined) return []
      const pcbPort = db.pcb_port.get(hole.pcb_port_id)
      if (!pcbPort) return []
      let rotationDegrees: number | undefined
      if (hole.pcb_component_id !== undefined)
        rotationDegrees = db.pcb_component.get(hole.pcb_component_id)?.rotation
      const outline = getPlatedHolePolygon(hole, rotationDegrees)
      return hole.layers.map((layer) => ({ pcbPort, layer, outline }))
    })
  return [...smtPads, ...platedHoles]
}

/** Convert physical via records, including standalone vias, to geometry. */
export function readRouteVia(via: PcbVia): RouteVia {
  return {
    pcbViaId: via.pcb_via_id,
    pcbTraceId: via.pcb_trace_id,
    sourceTraceId: via.source_trace_id,
    sourceNetId: via.source_net_id,
    point: [via.x, via.y],
    layers: via.layers,
    outerDiameterMm: via.outer_diameter,
  }
}

/** Resolve the occupied radius of a barrel or a point-only route via. */
function touchesVia({
  outline,
  via,
}: {
  outline: Polygon
  via: RouteVia
}): boolean {
  const [x, y] = via.point
  if (via.outerDiameterMm <= 0) {
    const point = new Point(x, y)
    return (
      outline.contains(point) ||
      outline.distanceTo(point)[0] <= CONTACT_TOLERANCE_MM
    )
  }
  const barrel = circlePolygon({ x, y }, via.outerDiameterMm / 2)
  return outlinesTouch({ first: outline, second: barrel })
}

/** Test coplanar contact with the same occupied outlines used by topology. */
function outlinesTouch({
  first,
  second,
}: {
  first: Polygon
  second: Polygon
}): boolean {
  return (
    first.box.extend(CONTACT_TOLERANCE_MM).intersect(second.box) &&
    copperPolygonsTouch(first, second, CONTACT_TOLERANCE_MM)
  )
}

/** Look for a physical pad or via connection to a planar conductor. */
function findPadWire({
  pad,
  wireOutlines,
  vias,
}: {
  pad: PortOutline
  wireOutlines: WireOutline[]
  vias: RouteVia[]
}): RouteWire | undefined {
  const direct = wireOutlines.find(
    ({ wire, outline }) =>
      wire.layer === pad.layer &&
      outlinesTouch({ first: pad.outline, second: outline }),
  )
  if (direct) return direct.wire
  for (const via of vias) {
    if (
      !via.layers.includes(pad.layer) ||
      !touchesVia({ outline: pad.outline, via })
    )
      continue
    const connected = wireOutlines.find(
      ({ wire, outline }) =>
        via.layers.includes(wire.layer) && touchesVia({ outline, via }),
    )
    if (connected) return connected.wire
  }
  return undefined
}

/** Determine whether an end of the merged wire or an original join reaches a pad. */
function touchesEnd({
  wire,
  point,
  pads,
}: {
  wire: RouteWire
  point: CopperPoint
  pads: PortOutline[]
}): boolean {
  const endpoints = [point]
  for (const join of wire.joins || []) {
    if (arePointsCoincident({ first: join.toPoint, second: point }))
      endpoints.push(join.fromPoint)
  }
  return pads.some(
    ({ outline, layer }) =>
      layer === wire.layer &&
      endpoints.some(([x, y]) => {
        const endpoint = new Point(x, y)
        return (
          outline.contains(endpoint) ||
          outline.distanceTo(endpoint)[0] <= CONTACT_TOLERANCE_MM
        )
      }),
  )
}

/** Resolve the pads on the same nets as modeled wires and mark their ends. */
export function resolveRouteContacts({
  circuit,
  wires,
  vias,
  copperScope,
}: {
  circuit: CircuitJson
  wires: RouteWire[]
  vias: RouteVia[]
  copperScope: Snapshot<CopperScope>
}): RouteContacts {
  const pads = getPortOutlines(circuit)
  const db = cju([...circuit])
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const wireOutlines = wires.flatMap((wire): WireOutline[] => {
    if (copperScope.nearbyRailPcbTraceIds.includes(wire.pcbTraceId)) return []
    const [startX, startY] = wire.startPoint
    const [endX, endY] = wire.endPoint
    return [
      {
        wire,
        outline: getTraceSegmentPolygon(
          { x: startX, y: startY },
          { x: endX, y: endY },
          wire.widthMm,
        ),
      },
    ]
  })
  const portContacts: RoutePortContact[] = []
  for (const pad of pads) {
    const sourcePortId = pad.pcbPort.source_port_id
    const netKey = connectivity.getNetConnectedToId(sourcePortId)
    const compatible = wireOutlines.filter(({ wire }) => {
      const source = db.source_trace.get(wire.sourceTraceId)
      if (!source) return false
      const sourceMemberId =
        source.connected_source_port_ids[0] ??
        source.connected_source_net_ids?.[0]
      return (
        sourceMemberId !== undefined &&
        (sourceMemberId === sourcePortId ||
          (netKey !== undefined &&
            connectivity.getNetConnectedToId(sourceMemberId) === netKey))
      )
    })
    const wire = findPadWire({ pad, wireOutlines: compatible, vias })
    if (wire)
      portContacts.push({
        pcbPortId: pad.pcbPort.pcb_port_id,
        point: [pad.pcbPort.x, pad.pcbPort.y],
        layer: pad.layer,
        wireIndex: wire.wireIndex,
      })
  }
  return {
    portContacts,
    wires: wires.map((wire) => ({
      ...wire,
      startTouchesPort: touchesEnd({ wire, point: wire.startPoint, pads }),
      endTouchesPort: touchesEnd({ wire, point: wire.endPoint, pads }),
    })),
  }
}

/** Locate the wire a physical PCB pad contacts, including a via on that pad. */
export function findContactWire({
  geometry,
  layer,
  point,
  pcbPortId,
}: {
  geometry: Snapshot<SectionGeometry>
  layer: LayerRef
  point: Snapshot<CopperPoint>
  pcbPortId?: PcbPortId
}): Snapshot<RouteWire> | undefined {
  const contact = geometry.portContacts.find(
    (contact) =>
      contact.layer === layer &&
      (pcbPortId === undefined || pcbPortId === contact.pcbPortId) &&
      arePointsCoincident({ first: contact.point, second: point }),
  )
  if (!contact) return undefined
  const wire = geometry.wires[contact.wireIndex]
  if (wire.layer === layer) return wire
  return { ...wire, layer }
}
