import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  type PlanHeaderRow,
  type PlanVisualCut,
  type PlanVisualEndpoint,
  pinName,
  planColors,
  planCutColor,
  type SourcePortId,
  type SourceTraceId,
} from "../board"
import {
  type CircuitNodes,
  connectionGraph,
  connectionPath,
} from "../simulation"
import type {
  PlanFault,
  PlanHop,
  PlanPath,
  PlanTopology,
  ResolvedPlanPath,
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
  const resolved = new Map(topology?.paths.map((path) => [path.to, path.hops]))
  for (const { name, from, to } of paths) {
    const hops = resolved.get(to)
    const firstTrace = hops?.find((hop) => hop.kind === "trace")
    const lastTrace = hops?.findLast((hop) => hop.kind === "trace")
    const driverTrace = firstTrace && cuts.get(firstTrace.trace)
    const receiverTrace = lastTrace && cuts.get(lastTrace.trace)
    let driverColor: string = planColors.existing
    if (driverTrace) driverColor = planCutColor(driverTrace.index)
    if (endpoints.get(from)?.kind !== "driver")
      endpoints.set(from, {
        id: from,
        kind: "driver",
        toward: firstTrace?.to || to,
        color: driverColor,
        label: `${name} · Driver ${endpointLabel({ id: from, labels, nodes: topology?.nodes })}`,
      })
    if (!endpoints.has(to)) {
      const isIdeal =
        hops !== undefined &&
        (hops.length === 0 || hops.at(-1)?.kind === "ideal")
      let kind: PlanVisualEndpoint["kind"] = "receiver"
      let color: string = planColors.existing
      if (receiverTrace) color = planCutColor(receiverTrace.index)
      if (isIdeal) {
        kind = "ideal"
        color = planColors.ideal
      }
      endpoints.set(to, {
        id: to,
        kind,
        color,
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
          kind: "extraTraceEnd",
          color: planCutColor(index),
          label: `Extra trace end · ${endpointLabel({ id, labels, nodes: topology?.nodes })}`,
        })
  }
  return [...endpoints.values()]
}

/** Board coordinates and layers for each routed source trace. */
interface TraceMeasure {
  length: number
  layers: Set<string>
}

/** Measure the routed wire runs, including transitions through pads. */
function traceMeasures(
  db: CircuitJsonUtilObjects,
): Map<SourceTraceId, TraceMeasure> {
  const measures = new Map<SourceTraceId, TraceMeasure>()
  for (const { source_trace_id: trace, route } of db.pcb_trace.list()) {
    if (trace === undefined) continue
    const details = measures.get(trace) || {
      length: 0,
      layers: new Set<string>(),
    }
    for (const [index, point] of route.entries()) {
      if (point.route_type === "wire") details.layers.add(point.layer)
      const previous = route[index - 1]
      if (!previous) continue
      const start =
        previous.route_type === "through_pad" ? previous.end : previous
      const end = point.route_type === "through_pad" ? point.start : point
      details.length += Math.hypot(end.x - start.x, end.y - start.y)
    }
    measures.set(trace, details)
  }
  return measures
}

/** Format a board dimension with trimmed decimals. */
export function planMillimeters(length: number): string {
  return `${Number(length.toFixed(2))} mm`
}

/** Join a route's dimensions, falling back to the route state without measurements. */
function traceDetail(measure: TraceMeasure | undefined): string {
  if (!measure?.layers.size) return "routed"
  return `${[...measure.layers].join("/")}, ${planMillimeters(measure.length)}`
}

/** Group the words for a count by number. */
export function planCount({
  count,
  noun,
}: {
  count: number
  noun: string
}): string {
  if (count === 1) return `1 ${noun}`
  return `${count} ${noun}s`
}

/** Get the part record from the source pin, even without a board pad. */
export function pinPart({
  id,
  db,
}: {
  id: SourcePortId
  db: CircuitJsonUtilObjects
}): ReturnType<CircuitJsonUtilObjects["source_component"]["get"]> {
  return db.source_component.get(
    db.source_port.get(id)?.source_component_id || "",
  )
}

/** Name the series part using its component record. */
export function seriesPart({
  from,
  db,
}: {
  from: SourcePortId
  db: CircuitJsonUtilObjects
}): string {
  const part = pinPart({ id: from, db })
  if (!part?.name) return "part"
  if (part.ftype === "simple_resistor") return `resistor ${part.name}`
  if (part.ftype === "simple_capacitor") return `capacitor ${part.name}`
  if (part.ftype === "simple_inductor") return `inductor ${part.name}`
  return `part ${part.name}`
}

/** An orientation-independent key for one physical or ideal hop. */
export function planHopKey(hop: PlanHop): string {
  if (hop.kind === "trace") return hop.trace
  return [hop.kind, ...[hop.from, hop.to].sort()].join(" ")
}

/** A single readable hop with its on-board endpoints. */
function pathRow({
  name,
  from,
  to,
  detail,
  color,
  db,
}: Pick<PlanPath, "name" | "from" | "to"> & {
  detail: string
  color: string
  db: CircuitJsonUtilObjects
}): PlanHeaderRow {
  return {
    text: `${name}: ${pinName({ id: from, db })} → ${pinName({ id: to, db })} (${detail})`,
    color,
  }
}

/** Orient extra traces away from their connection to a mapped path. */
export function planExtraTraces(
  topology: PlanTopology,
): readonly PlanVisualCut[] {
  const contacts = new Set(
    topology.paths
      .flatMap(({ from, to, hops }) => [
        from,
        to,
        ...hops.flatMap((hop) => [hop.from, hop.to]),
      ])
      .map((id) => topology.nodes[id])
      .filter((node) => node && node !== "0"),
  )
  const extras = topology.cuts.filter(({ mapped }) => !mapped)
  const ordered: PlanVisualCut[] = []
  while (extras.length) {
    const attached = extras.findIndex(
      ({ from, to }) =>
        contacts.has(topology.nodes[from]) || contacts.has(topology.nodes[to]),
    )
    const [cut] = extras.splice(Math.max(0, attached), 1)
    const { from, to } = cut
    if (!contacts.has(topology.nodes[from]) && contacts.has(topology.nodes[to]))
      ordered.push({ ...cut, from: to, to: from })
    else ordered.push(cut)
    for (const id of [from, to]) {
      const node = topology.nodes[id]
      if (node && node !== "0") contacts.add(node)
    }
  }
  return ordered
}

/** Descriptive lines for declared legs whose topology could not be built. */
function partialRows({
  paths,
  fault,
  measures,
  db,
}: {
  paths: readonly PlanPath[]
  fault: PlanFault
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const graph = connectionGraph(
    db.source_trace
      .list()
      .flatMap(({ source_trace_id, connected_source_port_ids }) => {
        const evidence = measures.get(source_trace_id)
        if (!evidence || connected_source_port_ids.length !== 2) return []
        const [fromNodeId, toNodeId] = connected_source_port_ids
        return [{ fromNodeId, toNodeId, evidence }]
      }),
  )
  return paths.flatMap((path) => {
    const { from, to } = path
    if (
      fault.links.some(
        (link) =>
          link.kind === "missing" && link.from === from && link.to === to,
      )
    )
      return [
        pathRow({
          ...path,
          detail: "missing trace",
          color: planColors.failure,
          db,
        }),
      ]
    const route = connectionPath({ graph, fromNodeId: from, toNodeId: to })
    if (!route?.length) return []
    const measure = {
      length: route.reduce((total, { evidence }) => total + evidence.length, 0),
      layers: new Set(route.flatMap(({ evidence }) => [...evidence.layers])),
    }
    return [
      pathRow({
        ...path,
        detail: traceDetail(measure),
        color: planColors.existing,
        db,
      }),
    ]
  })
}

/** Render path hops in signal order, sharing common segments across receivers. */
function routedRows({
  topology,
  extras,
  measures,
  db,
}: {
  topology: PlanTopology
  extras: readonly PlanVisualCut[]
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const cuts = new Map(topology.cuts.map((cut) => [cut.trace, cut]))
  const seen = new Set<string>()
  const rows: PlanHeaderRow[] = []
  for (const { name, hops } of topology.paths) {
    for (const hop of hops) {
      const key = `${name}: ${planHopKey(hop)} ${hop.from}`
      if (seen.has(key)) continue
      seen.add(key)
      if (hop.kind === "trace") {
        const cut = cuts.get(hop.trace)
        if (cut)
          rows.push(
            pathRow({
              ...hop,
              name,
              detail: traceDetail(measures.get(hop.trace)),
              color: planCutColor(cut.index),
              db,
            }),
          )
      } else if (hop.kind === "series") {
        const detail = `series ${seriesPart({ from: hop.from, db })}`
        rows.push(
          pathRow({ ...hop, name, detail, color: planColors.series, db }),
        )
      } else {
        rows.push(
          pathRow({
            ...hop,
            name,
            detail: "direct, no trace",
            color: planColors.ideal,
            db,
          }),
        )
      }
    }
  }
  for (const cut of extras)
    rows.push(
      pathRow({
        ...cut,
        name: "Extra trace",
        detail: traceDetail(measures.get(cut.trace)),
        color: planCutColor(cut.index),
        db,
      }),
    )
  return rows
}

/** Measure a set of trace IDs once, including when several receivers share copper. */
function totalLength({
  traces,
  measures,
}: {
  traces: ReadonlySet<SourceTraceId>
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
}): string {
  let length = 0
  for (const trace of traces) length += measures.get(trace)?.length || 0
  return planMillimeters(length)
}

/** Collapse a long route to one row per leg or one line for the whole board. */
function compactRows({
  topology,
  extras,
  limit,
  measures,
  db,
}: {
  topology: PlanTopology
  extras: number
  limit: number
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const groups = new Map<string, ResolvedPlanPath[]>()
  for (const path of topology.paths) {
    const group = groups.get(path.name) || []
    group.push(path)
    groups.set(path.name, group)
  }
  if (groups.size > limit || !groups.size) {
    const signals = new Set(topology.paths.map(({ channel }) => channel))
    const traces = new Set(topology.cuts.map(({ trace }) => trace))
    return [
      {
        text: `${planCount({ count: signals.size, noun: "signal" })} across ${planCount({ count: traces.size, noun: "trace" })} (${totalLength({ traces, measures })} total).`,
      },
    ]
  }
  let suffix = ""
  if (extras) suffix = `, +${extras} extra`
  const indices = new Map(
    topology.cuts.map(({ trace, index }) => [trace, index]),
  )
  return [...groups].map(([name, paths], index) => {
    const traces = new Set(
      paths.flatMap(({ hops }) =>
        hops.flatMap((hop) => {
          if (hop.kind === "trace") return [hop.trace]
          return []
        }),
      ),
    )
    const first = indices.get([...traces][0])
    let color: string = planColors.ideal
    if (first !== undefined) color = planCutColor(first)
    const driver = pinName({ id: paths[0].from, db })
    const receivers = paths.map(({ to }) => pinName({ id: to, db })).join(", ")
    const detail = `${planCount({ count: traces.size, noun: "trace" })}, ${totalLength({ traces, measures })}`
    return {
      text: `${name}: ${driver} → ${receivers} (${detail})${index === groups.size - 1 ? suffix : ""}`,
      color,
    }
  })
}

/** List the resolved route, leading with the shortcut when one bypasses it. */
export function planLedger({
  topology,
  paths,
  fault,
  db,
}: {
  topology?: PlanTopology
  paths: readonly PlanPath[]
  fault: PlanFault
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  if (!paths.length) return []
  const measures = traceMeasures(db)
  if (!topology) return partialRows({ paths, fault, measures, db })
  const shortcuts = fault.links
    .filter(({ kind }) => kind === "short")
    .map((link) => {
      const reverse = paths.some(
        ({ from, to }) => link.to === from && link.from === to,
      )
      if (reverse)
        return pathRow({
          from: link.to,
          to: link.from,
          name: "Shortcut",
          detail: "direct, no trace",
          color: planColors.failure,
          db,
        })
      return pathRow({
        ...link,
        name: "Shortcut",
        detail: "direct, no trace",
        color: planColors.failure,
        db,
      })
    })
  const extras = planExtraTraces(topology)
  const rows = routedRows({ topology, extras, measures, db })
  const limit = 4
  if (rows.length + shortcuts.length <= limit) return [...shortcuts, ...rows]
  return [
    ...shortcuts,
    ...compactRows({ topology, extras: extras.length, limit, measures, db }),
  ]
}
