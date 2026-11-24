import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  type PlanHeaderRow,
  type PlanVisualEndpoint,
  type PlanVisualLink,
  pinName,
  planColors,
  planCutColor,
  type SourcePortId,
  type SourceTraceId,
} from "../board"
import type { Diagnostic } from "../kernel"
import type { CircuitNodes } from "../simulation"
import type {
  PlanFault,
  PlanPath,
  PlanTopology,
} from "./transient-channel-simulation-plan-visual"

/** Keep the binding node in geometry hover labels. */
function endpointLabel({
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
export function planEndpoints({
  paths,
  topology,
  labels,
}: {
  paths: readonly PlanPath[]
  topology?: PlanTopology
  labels: ReadonlyMap<SourcePortId, string>
}): PlanVisualEndpoint[] {
  const endpoints = new Map<SourcePortId, PlanVisualEndpoint>()
  const cuts = new Map(topology?.cuts.map((cut) => [cut.trace, cut]))
  const mapped = new Map(topology?.paths.map((path) => [path.to, path.traces]))
  for (const { name, from, to } of paths) {
    const first = mapped.get(to)?.[0]
    const cut = cuts.get(first || "")
    const color = cut ? planCutColor(cut.index) : planColors.existing
    if (endpoints.get(from)?.kind !== "driver")
      endpoints.set(from, {
        id: from,
        kind: "driver",
        toward: cut?.to || to,
        color,
        label: `${name} · Driver ${endpointLabel({ id: from, labels, nodes: topology?.nodes })}`,
      })
    if (!endpoints.has(to)) {
      const ideal = topology !== undefined && !cut
      endpoints.set(to, {
        id: to,
        kind: ideal ? "ideal" : "receiver",
        color: ideal ? planColors.ideal : color,
        label: `${name} · Receiver ${endpointLabel({ id: to, labels, nodes: topology?.nodes })}`,
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
          color: planCutColor(index),
          label: `Load ${endpointLabel({ id, labels, nodes: topology?.nodes })}`,
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
      `${[...layers].join("/")} layer, ${Number(length.toFixed(2))} mm`,
    ]),
  )
}

/** Name the series part using its component record. */
function seriesPart({
  link,
  db,
}: {
  link: PlanVisualLink
  db: CircuitJsonUtilObjects
}): string {
  const pin = db.source_port.get(link.from)
  const part = db.source_component.get(pin?.source_component_id || "")
  if (!part) return "component"
  if (part.ftype === "simple_resistor") return `resistor ${part.name}`
  if (part.ftype === "simple_capacitor") return `capacitor ${part.name}`
  if (part.ftype === "simple_inductor") return `inductor ${part.name}`
  return `component ${part.name}`
}

/** Join series parts and direct pin connections in a single line. */
function connectionRow({
  links,
  db,
}: {
  links: readonly PlanVisualLink[]
  db: CircuitJsonUtilObjects
}): PlanHeaderRow {
  const details = links.map((link) => {
    if (link.kind === "series") return `Series ${seriesPart({ link, db })}`
    const from = pinName({ id: link.from, db })
    const to = pinName({ id: link.to, db })
    return `Direct connection from ${from} to ${to} (no trace)`
  })
  const row: PlanHeaderRow = { text: details.join(" • ") }
  if (links.every(({ kind }) => kind === "series"))
    row.color = planColors.series
  if (links.every(({ kind }) => kind === "ideal")) row.color = planColors.ideal
  return row
}

/** Keep a short row per trace, with a single summary for longer routes. */
export function planLedger({
  topology,
  fault,
  endpoints,
  db,
  failed,
}: {
  topology?: PlanTopology
  fault: PlanFault
  endpoints: readonly PlanVisualEndpoint[]
  db: CircuitJsonUtilObjects
  failed: boolean
}): PlanHeaderRow[] {
  if (!topology) return []
  const { cuts, segments, paths } = topology
  const limit = 3
  const rows: PlanHeaderRow[] = []
  if (cuts.length > limit) {
    rows.push({ text: `The drawing shows ${cuts.length} trace segments.` })
  } else {
    const details = cutDetails(db)
    const loads = new Set(
      endpoints.filter(({ kind }) => kind === "load").map(({ id }) => id),
    )
    for (const { trace, from, to, index, mapped } of cuts) {
      const start = pinName({ id: from, db })
      const end = pinName({ id: to, db })
      const channel = paths.find(({ traces }) => traces.includes(trace))?.name
      let text = `Trace from ${start} to ${end}`
      if (channel) text = `${channel}: ${start} to ${end}`
      if (!mapped) {
        text = `Extra trace from ${start} to ${end}`
        if (loads.has(to)) text = `Extra trace to ${end} (not a receiver)`
        else if (loads.has(from))
          text = `Extra trace to ${start} (not a receiver)`
      }
      const detail = details.get(trace)
      if (detail) text += ` — ${detail}`
      rows.push({
        text,
        color: fault.traces.has(trace)
          ? planColors.failure
          : planCutColor(index),
      })
    }
  }
  if (!failed && segments.length && rows.length < limit)
    rows.push(connectionRow({ links: segments, db }))
  return rows
}

/** Explain the failed connection using the same evidence as its red marks. */
export function planFailure({
  issue,
  error,
  paths,
  topology,
  fault,
  placed,
  db,
}: {
  issue?: Diagnostic
  error: unknown
  paths: readonly PlanPath[]
  topology?: PlanTopology
  fault: PlanFault
  placed: ReadonlySet<SourcePortId>
  db: CircuitJsonUtilObjects
}): string {
  if (error instanceof Error && error.cause === "scopeDistanceMm")
    return "Choose a copper search distance greater than zero."
  const path = paths.find(
    ({ from, to }) => fault.ports.has(from) && fault.ports.has(to),
  )
  const missing = fault.links.find(({ kind }) => kind === "missing")
  if (missing && path) {
    const from = pinName({ id: missing.from, db })
    const to = pinName({ id: missing.to, db })
    let marker = ""
    if (placed.has(missing.from) && placed.has(missing.to))
      marker = " (red dashed line)"
    if (issue?.code === "channel_receiver_terminal_missing")
      return `${path.name}: ${to} has no board connection to receive from ${from}${marker}.`
    return `${path.name}: no copper connects ${from} to ${to}${marker}.`
  }
  const pins = [...fault.ports]
  const names = pins.map((id) => pinName({ id, db }))
  if (issue?.code === "channel_driver_terminal_missing" && names.length)
    return `${names[0]} has no board pad for the driver.`
  if (issue?.code === "channel_fanout" && fault.traces.size)
    return `The traces through ${names.join(", ")} form a loop (red dashed traces).`
  if (issue?.code === "channel_fanout" && names.length)
    return `The route from ${names[0]} branches. This simulation needs a single path.`
  if (issue?.code === "channel_short") {
    const grounded = pins.find((id) => topology?.nodes[id] === "0")
    if (grounded)
      return `${pinName({ id: grounded, db })} is shorted to ground (red marker).`
    const bypass = fault.links.find(({ kind }) => kind === "short")
    if (bypass) {
      const from = pinName({ id: bypass.from, db })
      const to = pinName({ id: bypass.to, db })
      const traces =
        topology?.cuts.filter(({ trace }) => fault.traces.has(trace)) || []
      const contacts = new Set(traces.flatMap(({ from, to }) => [from, to]))
      const series =
        topology?.segments.filter(
          ({ kind, from, to }) =>
            kind === "series" && contacts.has(from) && contacts.has(to),
        ) || []
      const parts = series.map((link) => seriesPart({ link, db }))
      if (traces.length) parts.unshift("the traces")
      let skipped = ""
      if (parts.length) skipped = `, skipping ${parts.join(" and ")}`
      const name = path?.name || "The signal"
      return `${name} is shorted: ${from} connects directly to ${to}${skipped} (red dashes).`
    }
    if (names.length)
      return `Check the short at ${names.join(", ")} (red marks).`
  }
  return "Check the board and simulation settings. Hover here for details."
}
