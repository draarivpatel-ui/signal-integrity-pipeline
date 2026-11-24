import { Point, type Polygon } from "@flatten-js/core"
import {
  circlePolygon,
  cju,
  copperPolygonsTouch,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import type { PcbPort } from "circuit-json"
import { hypotenuse, type Snapshot } from "../kernel"
import {
  getSourcePortConnectivityMapFromCircuitJson,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "./connectivity"
import type { CopperScope } from "./geometry/scope"
import type { CopperPoint } from "./geometry/types"
import type { PcbPortId, SourceTraceId } from "./ids"
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

/** A via with its declared electrical associations resolved through the source circuit. */
interface ViaOutline {
  via: RouteVia
  members: SourceConnectionGroup
}

/** Look for a physical pad or via connection to a compatible planar conductor. */
function findPadWire({
  pad,
  wireOutlines,
  vias,
  netMembers,
}: {
  pad: PortOutline
  wireOutlines: WireOutline[]
  vias: ViaOutline[]
  netMembers: ReadonlySet<SourceConnectionGroup[number]>
}): RouteWire | undefined {
  const direct = wireOutlines.find(
    ({ wire, outline }) =>
      wire.layer === pad.layer &&
      outlinesTouch({ first: pad.outline, second: outline }),
  )
  if (direct) return direct.wire
  for (const { via, members } of vias) {
    if (
      !members.length ||
      !members.every((memberId) => netMembers.has(memberId)) ||
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

/** Test the physical endcap and any original endpoints translated by a union. */
function touchesEnd({
  wire,
  point,
  pad,
}: {
  wire: RouteWire
  point: CopperPoint
  pad: PortOutline
}): boolean {
  if (pad.layer !== wire.layer) return false
  const endpoints = [point]
  for (const join of wire.joins || []) {
    if (arePointsCoincident({ first: join.toPoint, second: point }))
      endpoints.push(join.fromPoint)
  }
  return endpoints.some(([x, y]) =>
    outlinesTouch({
      first: circlePolygon({ x, y }, wire.widthMm / 2),
      second: pad.outline,
    }),
  )
}

/** Find ports and nets named by a source trace. */
function getTraceMembers({
  db,
  sourceTraceId,
}: {
  db: ReturnType<typeof cju>
  sourceTraceId: SourceTraceId | undefined
}): SourceConnectionGroup {
  if (sourceTraceId === undefined) return []
  const trace = db.source_trace.get(sourceTraceId)
  if (!trace) return []
  return [
    ...trace.connected_source_port_ids,
    ...(trace.connected_source_net_ids || []),
  ]
}

/** Via ownership can come from a net, a source trace or a PCB trace. */
function getViaMembers({
  db,
  via,
}: {
  db: ReturnType<typeof cju>
  via: RouteVia
}): SourceConnectionGroup {
  const members = getTraceMembers({ db, sourceTraceId: via.sourceTraceId })
  if (via.pcbTraceId !== undefined) {
    const sourceTraceId = db.pcb_trace.get(via.pcbTraceId)?.source_trace_id
    if (sourceTraceId !== via.sourceTraceId)
      members.push(...getTraceMembers({ db, sourceTraceId }))
  }
  if (via.sourceNetId !== undefined) members.push(via.sourceNetId)
  return members
}

/** Outline of the planar conductor, including rounded copper ends. */
function getWireOutline(wire: RouteWire): WireOutline {
  const [startX, startY] = wire.startPoint
  const [endX, endY] = wire.endPoint
  return {
    wire,
    outline: getTraceSegmentPolygon(
      { x: startX, y: startY },
      { x: endX, y: endY },
      wire.widthMm,
    ),
  }
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
  const wireOutlines = wires
    .filter(
      (wire) => !copperScope.nearbyRailPcbTraceIds.includes(wire.pcbTraceId),
    )
    .map(getWireOutline)
  const viaOutlines = vias.map((via) => ({
    via,
    members: getViaMembers({ db, via }),
  }))
  const traceMembers = new Map(
    db.source_trace
      .list()
      .map(({ source_trace_id: sourceTraceId }) => [
        sourceTraceId,
        getTraceMembers({ db, sourceTraceId }),
      ]),
  )
  const portContacts: RoutePortContact[] = []
  const startsTouchingPorts = new Set<number>()
  const endsTouchingPorts = new Set<number>()
  for (const pad of pads) {
    const netMembers = sourceNetMembers({
      connectivity,
      memberId: pad.pcbPort.source_port_id,
    })
    const compatibleWires = wireOutlines.filter(({ wire }) =>
      traceMembers
        .get(wire.sourceTraceId)
        ?.some((memberId) => netMembers.has(memberId)),
    )
    for (const { wire } of compatibleWires) {
      if (touchesEnd({ wire, point: wire.startPoint, pad }))
        startsTouchingPorts.add(wire.wireIndex)
      if (touchesEnd({ wire, point: wire.endPoint, pad }))
        endsTouchingPorts.add(wire.wireIndex)
    }
    const wire = findPadWire({
      pad,
      wireOutlines: compatibleWires,
      vias: viaOutlines,
      netMembers,
    })
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
      startTouchesPort: startsTouchingPorts.has(wire.wireIndex),
      endTouchesPort: endsTouchingPorts.has(wire.wireIndex),
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
  return wire
}
