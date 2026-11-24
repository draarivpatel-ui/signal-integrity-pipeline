import { cju } from "@tscircuit/circuit-json-util"
import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import { readRouteVia, resolveRouteContacts } from "./route-contacts"
import {
  MAX_REFERENCE_EDGE_DISTANCE_MM,
  normalizeReferencePour,
} from "./route-references"
import { sweepRouteSections } from "./route-section-sweep"
import type {
  RouteVia,
  RouteWire,
  SectionGeometry,
} from "./route-section-types"
import { simplifyRouteWires } from "./route-simplify"
import { unionRouteWires } from "./route-union"
import type { CircuitJson } from "./schema"
import { stackupFromCircuitJson } from "./stackup"
import { extractTraceWires } from "./trace-wires"

/** One micrometre limits chord deviation below ordinary copper feature tolerances. */
const CHORD_TOLERANCE_MM = 0.001

/** Board circuit and copper kept for route sectioning. */
interface RouteSectionOptions {
  circuit: CircuitJson
  copperScope: Snapshot<CopperScope>
}

/** Work completed before computing sections and contacts. */
export interface RouteSectionProgress {
  traces: number
  wires: number
}

/** Simplify and union the wires before computing electrical contacts and references. */
function finalizeGeometry({
  circuit,
  copperScope,
  wires,
  embeddedVias,
}: RouteSectionOptions & {
  wires: RouteWire[]
  embeddedVias: RouteVia[]
}): SectionGeometry {
  const db = cju([...circuit])
  const stackup = stackupFromCircuitJson(circuit)
  const pours = db.pcb_copper_pour.list().flatMap((pour) => {
    if (
      !copperScope.referencePcbCopperPourIds.includes(pour.pcb_copper_pour_id)
    )
      return []
    return normalizeReferencePour(pour)
  })
  const scopedVias = db.pcb_via
    .list()
    .filter((via) => copperScope.extractedPcbViaIds.includes(via.pcb_via_id))
    .map(readRouteVia)
  const vias = [
    ...scopedVias,
    ...embeddedVias.filter(
      (embedded) =>
        !scopedVias.some(
          (via) =>
            via.pcbTraceId === embedded.pcbTraceId &&
            via.point[0] === embedded.point[0] &&
            via.point[1] === embedded.point[1],
        ),
    ),
  ]
  const simplified = simplifyRouteWires({
    wires,
    toleranceMm: CHORD_TOLERANCE_MM,
  })
  const mergedWires = unionRouteWires({ wires: simplified.wires, circuit })
  const contacts = resolveRouteContacts({
    circuit,
    wires: mergedWires,
    vias,
    copperScope,
  })
  const geometry = { ...contacts, stackup, pours, vias }
  return {
    ...geometry,
    sections: sweepRouteSections({ geometry, copperScope }),
    warnings: [
      `Chord tolerance ${CHORD_TOLERANCE_MM} mm reduced ${wires.length} wires to ${simplified.wires.length}. Total length changed from ${simplified.originalLengthMm} to ${simplified.simplifiedLengthMm} mm.`,
      "Overlapping parallel same-net wires share one copper rectangle. The original endpoints join its centerline through ideal connections.",
      `When no reference lies above or below a wire, a pour edge within ${MAX_REFERENCE_EDGE_DISTANCE_MM} mm supplies an effective reference surface. The distance combines the vertical gap and lateral gap.`,
      "Wires with different directions are sectioned independently.",
    ],
  }
}

/** Extract one trace per step and report counts independent of the working geometry. */
export function* stepRouteSections({
  circuit,
  copperScope,
}: RouteSectionOptions): Generator<RouteSectionProgress, SectionGeometry> {
  const db = cju([...circuit])
  const wires: RouteWire[] = []
  const embeddedVias: RouteVia[] = []
  const traces = db.pcb_trace
    .list()
    .filter((trace) =>
      copperScope.extractedPcbTraceIds.includes(trace.pcb_trace_id),
    )
  for (const [index, trace] of traces.entries()) {
    const extracted = extractTraceWires({
      circuit,
      trace,
      firstWireIndex: wires.length,
    })
    wires.push(...extracted.wires)
    embeddedVias.push(...extracted.vias)
    yield { traces: index + 1, wires: wires.length }
  }
  return finalizeGeometry({ circuit, copperScope, wires, embeddedVias })
}

/** Compute route sections synchronously when incremental progress is unnecessary. */
export function sectionRoutes(options: RouteSectionOptions): SectionGeometry {
  const steps = stepRouteSections(options)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}
