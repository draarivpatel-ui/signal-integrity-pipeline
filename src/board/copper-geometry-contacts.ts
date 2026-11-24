import { Point, type Polygon } from "@flatten-js/core"
import {
  circlePolygon,
  type cju,
  copperPolygonsTouch,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getViaPolygon,
} from "@tscircuit/circuit-json-util"
import type { PcbPort } from "circuit-json"
import type { Snapshot } from "../kernel"
import {
  type ConnectivityMap,
  getTraceMembers,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "./connectivity"
import {
  getWireOutlines,
  type WireOutline,
} from "./copper-geometry-contact-outlines"
import { CONTACT_TOLERANCE_MM } from "./copper-geometry-pad-contact"
import type { WireChord } from "./copper-geometry-simplify"
import type {
  CopperVia,
  ExtractedCopper,
  PadContact,
  TraceWire,
} from "./copper-geometry-types"
import type { UnionedWire } from "./copper-geometry-union"
import { getViaMembers } from "./copper-geometry-vias"
import type { CopperScope } from "./geometry/scope"
import type { LayerRef } from "./schema"

/** A pad outline in contact with zero or more planar conductors. */
interface PortOutline {
  pcbPort: PcbPort
  layer: LayerRef
  outline: Polygon
}

/** Resolved contacts on real PCB ports and tagged wire endpoints. */
type PadContacts = Pick<ExtractedCopper, "wires" | "portContacts">

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
  via: CopperVia
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
  via: CopperVia
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
}): TraceWire | undefined {
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

/** Resolve the pads on the same nets as modeled wires and mark their ends. */
export function resolvePadContacts({
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
  vias: CopperVia[]
  copperScope: Snapshot<CopperScope>
}): PadContacts {
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
  const portContacts: PadContact[] = []
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
