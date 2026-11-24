import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  type AdmissionHeaderRow,
  type AdmissionVisualEndpoint,
  admissionColors,
  admissionCutColor,
  type SourcePortId,
  type SourceTraceId,
} from "../board"
import type { CircuitNodes } from "../simulation"
import type {
  AdmissionFault,
  AdmissionPath,
  AdmissionTopology,
} from "./routed-admission-visual"

/** Build a pin caption with the node used by binding, when available. */
function pinCaption({
  id,
  labels,
  nodes,
}: {
  id: SourcePortId
  labels: ReadonlyMap<SourcePortId, string>
  nodes?: CircuitNodes["mapping"]
}): string {
  const label = labels.get(id) || id
  const node = nodes?.[id]
  if (node !== undefined) return `${label} (${node})`
  return label
}

/** Keep one glyph per physical declaration, with drivers taking precedence. */
export function admissionEndpoints({
  paths,
  topology,
  labels,
}: {
  paths: readonly AdmissionPath[]
  topology?: AdmissionTopology
  labels: ReadonlyMap<SourcePortId, string>
}): AdmissionVisualEndpoint[] {
  const endpoints = new Map<SourcePortId, AdmissionVisualEndpoint>()
  const cuts = new Map(topology?.cuts.map((cut) => [cut.trace, cut]))
  const mapped = new Map(topology?.paths.map((path) => [path.to, path.traces]))
  for (const { name, from, to } of paths) {
    const first = mapped.get(to)?.[0]
    const cut = cuts.get(first || "")
    const color = cut ? admissionCutColor(cut.index) : admissionColors.existing
    if (endpoints.get(from)?.kind !== "driver")
      endpoints.set(from, {
        id: from,
        kind: "driver",
        toward: cut?.to || to,
        color,
        label: `${name} · Driver ${pinCaption({ id: from, labels, nodes: topology?.nodes })}`,
      })
    if (!endpoints.has(to)) {
      const ideal = topology !== undefined && !cut
      endpoints.set(to, {
        id: to,
        kind: ideal ? "ideal" : "receiver",
        color: ideal ? admissionColors.ideal : color,
        label: `${name} · Receiver ${pinCaption({ id: to, labels, nodes: topology?.nodes })}`,
      })
    }
  }
  for (const { from, to, mapped, index } of topology?.cuts || []) {
    if (mapped) continue
    for (const id of [from, to])
      if (!endpoints.has(id))
        endpoints.set(id, {
          id,
          kind: "load",
          color: admissionCutColor(index),
          label: `Load ${pinCaption({ id, labels, nodes: topology?.nodes })}`,
        })
  }
  return [...endpoints.values()]
}

/** Summarize the layers and length of each routed copper record. */
function cutDetails(db: CircuitJsonUtilObjects): Map<SourceTraceId, string> {
  const measures = new Map<
    SourceTraceId,
    { length: number; layers: Set<string> }
  >()
  for (const trace of db.pcb_trace.list()) {
    if (trace.source_trace_id === undefined) continue
    const details = measures.get(trace.source_trace_id) || {
      length: 0,
      layers: new Set<string>(),
    }
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type === "wire") details.layers.add(point.layer)
      const previous = trace.route[index - 1]
      if (!previous) continue
      const start =
        previous.route_type === "through_pad" ? previous.end : previous
      const end = point.route_type === "through_pad" ? point.start : point
      details.length += Math.hypot(end.x - start.x, end.y - start.y)
    }
    measures.set(trace.source_trace_id, details)
  }
  return new Map(
    [...measures].map(([trace, { length, layers }]) => [
      trace,
      `${[...layers].join("/")} · ${Number(length.toFixed(2))} mm`,
    ]),
  )
}

/** Translate the physical and logical paths into the centered admission ledger. */
export function admissionLedger({
  paths,
  topology,
  fault,
  labels,
  existingTraces,
  db,
}: {
  paths: readonly AdmissionPath[]
  topology?: AdmissionTopology
  fault: AdmissionFault
  existingTraces: ReadonlySet<SourceTraceId>
  db: CircuitJsonUtilObjects
  labels: ReadonlyMap<SourcePortId, string>
}): AdmissionHeaderRow[] {
  const details = cutDetails(db)
  const cuts = topology?.cuts || []
  const ids = new Map(cuts.map((cut) => [cut.trace, `C${cut.index + 1}`]))
  const mapped = new Map(topology?.paths.map((path) => [path.to, path.traces]))
  const rows: AdmissionHeaderRow[] = []
  for (const { name, from, to } of paths) {
    const caption = `${name} · ${pinCaption({ id: from, labels })} → ${pinCaption({ id: to, labels })}`
    const traces = mapped.get(to)
    if (
      fault.links.some(
        (link) =>
          link.kind === "missing" && link.from === from && link.to === to,
      )
    )
      rows.push({ text: `${caption} · OPEN`, color: admissionColors.failure })
    else if (traces)
      rows.push({
        text: `${caption} · ${traces.map((id) => ids.get(id)).join(" → ") || "Ideal only"}`,
      })
    else if (fault.ports.has(from) || fault.ports.has(to))
      rows.push({ text: caption, color: admissionColors.failure })
    else {
      const existing = db.source_trace
        .list()
        .find(
          (trace) =>
            existingTraces.has(trace.source_trace_id) &&
            trace.connected_source_port_ids.includes(from) &&
            trace.connected_source_port_ids.includes(to),
        )
      if (existing)
        rows.push({
          text: `${caption} · Routed`,
          color: admissionColors.existing,
        })
      else rows.push({ text: caption })
    }
  }
  for (const { trace, from, to, index, mapped: used } of cuts) {
    const text = `C${index + 1} · ${pinCaption({ id: from, labels, nodes: topology?.nodes })} → ${pinCaption({ id: to, labels, nodes: topology?.nodes })}`
    const reading = details.get(trace)
    const row = reading ? `${text} · ${reading}` : text
    rows.push({
      text: used ? row : `${row} · LOAD`,
      color: fault.traces.has(trace)
        ? admissionColors.failure
        : admissionCutColor(index),
    })
  }
  for (const { from, to, kind, label } of topology?.segments || []) {
    const bypass = fault.links.some(
      (link) => link.kind === "short" && link.from === from && link.to === to,
    )
    const title = bypass ? "Ideal bypass" : label
    const text = `${title} · ${pinCaption({ id: from, labels, nodes: topology?.nodes })} ↔ ${pinCaption({ id: to, labels, nodes: topology?.nodes })}`
    rows.push({
      text,
      color: bypass
        ? admissionColors.failure
        : kind === "series"
          ? admissionColors.series
          : admissionColors.ideal,
    })
  }
  return rows
}
