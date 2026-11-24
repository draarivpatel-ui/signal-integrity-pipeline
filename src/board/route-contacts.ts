import { Point, type Polygon } from "@flatten-js/core"
import {
  circlePolygon,
  type cju,
  copperPolygonsTouch,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getTraceSegmentPolygon,
  getViaPolygon,
} from "@tscircuit/circuit-json-util"
import type { PcbPort } from "circuit-json"
import { hypotenuse, type Snapshot } from "../kernel"
import {
  type ConnectivityMap,
  getTraceMembers,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "./connectivity"
import type { CopperScope } from "./geometry/scope"
import type { CopperPoint } from "./geometry/types"
import type { PcbPortId } from "./ids"
import type {
  RoutePortContact,
  RouteVia,
  RouteWire,
  SectionGeometry,
} from "./route-section-types"
import type { WireChord } from "./route-simplify"
import type { UnionedWire } from "./route-union"
import { getViaMembers } from "./route-vias"
import type { LayerRef } from "./schema"

/** Physical outlines and point contacts use the same tolerance as topology validation. */
const CONTACT_TOLERANCE_MM = 1e-5

/** A pad outline in contact with zero or more planar conductors. */
interface PortOutline {
  pcbPort: PcbPort
  layer: LayerRef
  outline: Polygon
}

/** Actual copper contributing to a modeled wire interval. */
interface WireOutline {
  wire: RouteWire
  physicalWire: RouteWire
  outline: Polygon
  startCap?: Polygon
  endCap?: Polygon
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
function getPortOutlines(db: ReturnType<typeof cju>): PortOutline[] {
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
  let barrel: Polygon
  if (via.holeDiameterMm === undefined)
    barrel = circlePolygon({ x, y }, via.outerDiameterMm / 2)
  else barrel = getViaPolygon({ x, y }, via.outerDiameterMm, via.holeDiameterMm)
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

/** Clamp an interpolation fraction to the original wire segment. */
function clampFraction(fraction: number): number {
  return Math.max(0, Math.min(1, fraction))
}

/** Clip a physical segment to the modeled longitudinal interval. */
function getWireOutline({
  wire,
  physicalWire,
}: {
  wire: RouteWire
  physicalWire: RouteWire
}): WireOutline | undefined {
  const [axisX, axisY] = wire.direction
  const [startX, startY] = physicalWire.startPoint
  const [endX, endY] = physicalWire.endPoint
  const dx = endX - startX
  const dy = endY - startY
  const startMm = startX * axisX + startY * axisY
  const endMm = endX * axisX + endY * axisY
  if (
    Math.max(startMm, endMm) < wire.longitudinalMinMm - CONTACT_TOLERANCE_MM ||
    Math.min(startMm, endMm) > wire.longitudinalMaxMm + CONTACT_TOLERANCE_MM
  )
    return undefined

  const intervalStartMm =
    wire.startPoint[0] * axisX + wire.startPoint[1] * axisY
  const intervalEndMm = wire.endPoint[0] * axisX + wire.endPoint[1] * axisY
  let startFraction = 0
  let endFraction = 1
  if (startMm !== endMm) {
    startFraction = clampFraction(
      (intervalStartMm - startMm) / (endMm - startMm),
    )
    endFraction = clampFraction((intervalEndMm - startMm) / (endMm - startMm))
  }
  const start = {
    x: startX + dx * startFraction,
    y: startY + dy * startFraction,
  }
  const end = { x: startX + dx * endFraction, y: startY + dy * endFraction }
  const outline: WireOutline = {
    wire,
    physicalWire,
    outline: getTraceSegmentPolygon(start, end, physicalWire.widthMm),
  }
  const radiusMm = physicalWire.widthMm / 2
  if (
    Math.abs(start.x * axisX + start.y * axisY - intervalStartMm) <=
    CONTACT_TOLERANCE_MM
  )
    outline.startCap = circlePolygon(start, radiusMm)
  if (
    Math.abs(end.x * axisX + end.y * axisY - intervalEndMm) <=
    CONTACT_TOLERANCE_MM
  )
    outline.endCap = circlePolygon(end, radiusMm)
  return outline
}

/** Associate physical copper with every modeled interval it contributes to. */
function getWireOutlines({
  mergedWires,
  chords,
  copperScope,
}: {
  mergedWires: UnionedWire[]
  chords: WireChord[]
  copperScope: Snapshot<CopperScope>
}): WireOutline[] {
  const outlines: WireOutline[] = []
  for (const { wire, contributingWires } of mergedWires) {
    for (const chord of contributingWires) {
      if (copperScope.nearbyRailPcbTraceIds.includes(chord.pcbTraceId)) continue
      for (const physicalWire of chords[chord.wireIndex].physicalWires) {
        const outline = getWireOutline({ wire, physicalWire })
        if (outline) outlines.push(outline)
      }
    }
  }
  return outlines
}

/** Resolve the pads on the same nets as modeled wires and mark their ends. */
export function resolveRouteContacts({
  db,
  connectivity,
  chords,
  mergedWires,
  vias,
  copperScope,
}: {
  db: ReturnType<typeof cju>
  connectivity: ConnectivityMap
  chords: WireChord[]
  mergedWires: UnionedWire[]
  vias: RouteVia[]
  copperScope: Snapshot<CopperScope>
}): RouteContacts {
  const pads = getPortOutlines(db)
  const wireOutlines = getWireOutlines({ mergedWires, chords, copperScope })
  const traceMembers = new Map(
    db.source_trace
      .list()
      .map((trace) => [trace.source_trace_id, getTraceMembers(trace)]),
  )
  const viaOutlines = vias.map((via) => ({
    via,
    members: getViaMembers({ db, via, traceMembers }),
  }))
  const portContacts: RoutePortContact[] = []
  const startContactWireIndices = new Set<number>()
  const endContactWireIndices = new Set<number>()
  for (const pad of pads) {
    const netMembers = sourceNetMembers({
      connectivity,
      memberId: pad.pcbPort.source_port_id,
    })
    const compatibleWires = wireOutlines.filter(({ physicalWire }) =>
      traceMembers
        .get(physicalWire.sourceTraceId)
        ?.some((memberId) => netMembers.has(memberId)),
    )
    for (const { wire, startCap, endCap } of compatibleWires) {
      if (pad.layer !== wire.layer) continue
      if (startCap && outlinesTouch({ first: startCap, second: pad.outline }))
        startContactWireIndices.add(wire.wireIndex)
      if (endCap && outlinesTouch({ first: endCap, second: pad.outline }))
        endContactWireIndices.add(wire.wireIndex)
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
    wires: mergedWires.map(({ wire }) => ({
      ...wire,
      startTouchesPort: startContactWireIndices.has(wire.wireIndex),
      endTouchesPort: endContactWireIndices.has(wire.wireIndex),
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
