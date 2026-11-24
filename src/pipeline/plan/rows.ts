import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  getPinName,
  getTraceColor,
  type PlanHeaderRow,
  type PlanTrace,
  type PlanVisualEndpoint,
  planColors,
  type SourcePortId,
  type SourceTraceId,
} from "../../board"
import {
  type CircuitNodes,
  connectionGraph,
  connectionPath,
} from "../../simulation"
import type { PlanFault } from "./fault"
import {
  describeTrace,
  formatTotalLengthMm,
  measureTraces,
  type TraceMeasure,
} from "./measure"
import type {
  PlanPath,
  PlanPathSegment,
  PlanTopology,
  ResolvedPlanPath,
} from "./visual"

/** Keep the binding node in geometry hover labels. */
function formatEndpointLabel({
  sourcePortId,
  labels,
  nodes,
}: {
  sourcePortId: SourcePortId
  labels: ReadonlyMap<SourcePortId, string>
  nodes?: CircuitNodes["mapping"]
}): string {
  const label = labels.get(sourcePortId) || sourcePortId
  const node = nodes?.[sourcePortId]
  if (node !== undefined) return `${label} (${node})`
  return label
}

/** Keep one glyph per physical declaration, with drivers taking precedence. */
export function buildEndpoints({
  paths,
  topology,
  labels,
}: {
  paths: readonly PlanPath[]
  topology?: PlanTopology
  labels: ReadonlyMap<SourcePortId, string>
}): PlanVisualEndpoint[] {
  const endpoints = new Map<SourcePortId, PlanVisualEndpoint>()
  const traceContacts = new Map(
    topology?.traces.map((cut) => [cut.sourceTraceId, cut]),
  )
  const resolved = new Map(
    topology?.paths.map((path) => [path.toSourcePortId, path.pathSegments]),
  )
  for (const { signalName, fromSourcePortId, toSourcePortId } of paths) {
    const pathSegments = resolved.get(toSourcePortId)
    const firstTrace = pathSegments?.find((segment) => segment.kind === "trace")
    const lastTrace = pathSegments?.findLast(
      (segment) => segment.kind === "trace",
    )
    const driverTrace =
      firstTrace && traceContacts.get(firstTrace.sourceTraceId)
    const receiverTrace =
      lastTrace && traceContacts.get(lastTrace.sourceTraceId)
    let driverColor: string = planColors.existing
    if (driverTrace) driverColor = getTraceColor(driverTrace.index)
    if (endpoints.get(fromSourcePortId)?.kind !== "driver")
      endpoints.set(fromSourcePortId, {
        sourcePortId: fromSourcePortId,
        kind: "driver",
        towardSourcePortId: firstTrace?.toSourcePortId || toSourcePortId,
        color: driverColor,
        label: `${signalName} · Driver ${formatEndpointLabel({ sourcePortId: fromSourcePortId, labels, nodes: topology?.nodes })}`,
      })
    if (!endpoints.has(toSourcePortId)) {
      const isIdeal =
        pathSegments !== undefined &&
        (pathSegments.length === 0 || pathSegments.at(-1)?.kind === "ideal")
      let kind: PlanVisualEndpoint["kind"] = "receiver"
      let color: string = planColors.existing
      if (receiverTrace) color = getTraceColor(receiverTrace.index)
      if (isIdeal) {
        kind = "ideal"
        color = planColors.ideal
      }
      endpoints.set(toSourcePortId, {
        sourcePortId: toSourcePortId,
        kind,
        color,
        label: `${signalName} · Receiver ${formatEndpointLabel({ sourcePortId: toSourcePortId, labels, nodes: topology?.nodes })}`,
      })
    }
  }
  for (const {
    fromSourcePortId,
    toSourcePortId,
    isMapped,
    index,
  } of topology?.traces || []) {
    if (isMapped) continue
    for (const sourcePortId of [fromSourcePortId, toSourcePortId])
      if (!endpoints.has(sourcePortId))
        endpoints.set(sourcePortId, {
          sourcePortId,
          kind: "extraTraceEnd",
          color: getTraceColor(index),
          label: `Extra trace end · ${formatEndpointLabel({ sourcePortId, labels, nodes: topology?.nodes })}`,
        })
  }
  return [...endpoints.values()]
}

/** Group the words for a count by number. */
export function formatCount({
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
export function findPinPart({
  sourcePortId,
  db,
}: {
  sourcePortId: SourcePortId
  db: CircuitJsonUtilObjects
}): ReturnType<CircuitJsonUtilObjects["source_component"]["get"]> {
  return db.source_component.get(
    db.source_port.get(sourcePortId)?.source_component_id || "",
  )
}

/** Name the series part using its component record. */
export function describeSeriesPart({
  fromSourcePortId,
  db,
}: {
  fromSourcePortId: SourcePortId
  db: CircuitJsonUtilObjects
}): string {
  const part = findPinPart({ sourcePortId: fromSourcePortId, db })
  if (!part?.name) return "part"
  if (part.ftype === "simple_resistor") return `resistor ${part.name}`
  if (part.ftype === "simple_capacitor") return `capacitor ${part.name}`
  if (part.ftype === "simple_inductor") return `inductor ${part.name}`
  return `part ${part.name}`
}

/** An orientation-independent key for one physical or ideal hop. */
export function getSegmentKey(segment: PlanPathSegment): string {
  if (segment.kind === "trace") return segment.sourceTraceId
  return [
    segment.kind,
    ...[segment.fromSourcePortId, segment.toSourcePortId].sort(),
  ].join(" ")
}

/** A single readable hop with its on-board endpoints. */
function buildPathRow({
  signalName,
  fromSourcePortId,
  toSourcePortId,
  detail,
  color,
  db,
}: Pick<PlanPath, "signalName" | "fromSourcePortId" | "toSourcePortId"> & {
  detail: string
  color: string
  db: CircuitJsonUtilObjects
}): PlanHeaderRow {
  return {
    text: `${signalName}: ${getPinName({ sourcePortId: fromSourcePortId, db })} → ${getPinName({ sourcePortId: toSourcePortId, db })} (${detail})`,
    color,
  }
}

/** Orient extra traces away from their connection to a mapped path. */
export function orderExtraTraces(topology: PlanTopology): readonly PlanTrace[] {
  const contacts = new Set(
    topology.paths
      .flatMap(({ fromSourcePortId, toSourcePortId, pathSegments }) => [
        fromSourcePortId,
        toSourcePortId,
        ...pathSegments.flatMap((segment) => [
          segment.fromSourcePortId,
          segment.toSourcePortId,
        ]),
      ])
      .map((sourcePortId) => topology.nodes[sourcePortId])
      .filter((node) => node && node !== "0"),
  )
  const extras = topology.traces.filter(({ isMapped }) => !isMapped)
  const ordered: PlanTrace[] = []
  while (extras.length) {
    const attached = extras.findIndex(
      ({ fromSourcePortId, toSourcePortId }) =>
        contacts.has(topology.nodes[fromSourcePortId]) ||
        contacts.has(topology.nodes[toSourcePortId]),
    )
    const [cut] = extras.splice(Math.max(0, attached), 1)
    const { fromSourcePortId, toSourcePortId } = cut
    if (
      !contacts.has(topology.nodes[fromSourcePortId]) &&
      contacts.has(topology.nodes[toSourcePortId])
    )
      ordered.push({
        ...cut,
        fromSourcePortId: toSourcePortId,
        toSourcePortId: fromSourcePortId,
      })
    else ordered.push(cut)
    for (const sourcePortId of [fromSourcePortId, toSourcePortId]) {
      const node = topology.nodes[sourcePortId]
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
        const [fromVertexId, toVertexId] = connected_source_port_ids
        return [{ fromVertexId, toVertexId, evidence }]
      }),
  )
  return paths.flatMap((path) => {
    const { fromSourcePortId, toSourcePortId } = path
    if (
      fault.overlays.some(
        (link) =>
          link.kind === "missing" &&
          link.fromSourcePortId === fromSourcePortId &&
          link.toSourcePortId === toSourcePortId,
      )
    )
      return [
        buildPathRow({
          ...path,
          detail: "incomplete route",
          color: planColors.failure,
          db,
        }),
      ]
    const route = connectionPath({
      graph,
      fromVertexId: fromSourcePortId,
      toVertexId: toSourcePortId,
    })
    if (!route?.length) return []
    const measure = {
      lengthMm: route.reduce(
        (total, { evidence }) => total + evidence.lengthMm,
        0,
      ),
      layers: new Set(route.flatMap(({ evidence }) => [...evidence.layers])),
    }
    return [
      buildPathRow({
        ...path,
        detail: describeTrace(measure),
        color: planColors.existing,
        db,
      }),
    ]
  })
}

/** Render path hops in signal order, sharing common segments across receivers. */
function buildDetailedRows({
  topology,
  extras,
  measures,
  db,
}: {
  topology: PlanTopology
  extras: readonly PlanTrace[]
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const traceContacts = new Map(
    topology.traces.map((cut) => [cut.sourceTraceId, cut]),
  )
  const seen = new Set<string>()
  const rows: PlanHeaderRow[] = []
  for (const { signalName, pathSegments } of topology.paths) {
    for (const segment of pathSegments) {
      const key = `${signalName}: ${getSegmentKey(segment)} ${segment.fromSourcePortId}`
      if (seen.has(key)) continue
      seen.add(key)
      if (segment.kind === "trace") {
        const cut = traceContacts.get(segment.sourceTraceId)
        if (cut)
          rows.push(
            buildPathRow({
              ...segment,
              signalName,
              detail: describeTrace(measures.get(segment.sourceTraceId)),
              color: getTraceColor(cut.index),
              db,
            }),
          )
      } else if (segment.kind === "series") {
        const detail = `series ${describeSeriesPart({ fromSourcePortId: segment.fromSourcePortId, db })}`
        rows.push(
          buildPathRow({
            ...segment,
            signalName,
            detail,
            color: planColors.series,
            db,
          }),
        )
      } else {
        rows.push(
          buildPathRow({
            ...segment,
            signalName,
            detail: "ideal connection",
            color: planColors.ideal,
            db,
          }),
        )
      }
    }
  }
  for (const cut of extras)
    rows.push(
      buildPathRow({
        ...cut,
        signalName: "Extra trace",
        detail: describeTrace(measures.get(cut.sourceTraceId)),
        color: getTraceColor(cut.index),
        db,
      }),
    )
  return rows
}

/** Collapse a long route to one row per leg or one line for the whole board. */
function buildCompactRows({
  topology,
  extraTraceCount,
  limit,
  measures,
  db,
}: {
  topology: PlanTopology
  extraTraceCount: number
  limit: number
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const groups = new Map<string, ResolvedPlanPath[]>()
  for (const path of topology.paths) {
    const group = groups.get(path.signalName) || []
    group.push(path)
    groups.set(path.signalName, group)
  }
  if (groups.size > limit || !groups.size) {
    const signals = new Set(
      topology.paths.map(({ channelName }) => channelName),
    )
    const traces = new Set(
      topology.traces.map(({ sourceTraceId }) => sourceTraceId),
    )
    return [
      {
        text: `${formatCount({ count: signals.size, noun: "signal" })} across ${formatCount({ count: traces.size, noun: "trace" })} (${formatTotalLengthMm({ traces, measures })} total).`,
      },
    ]
  }
  let suffix = ""
  if (extraTraceCount) suffix = `, +${extraTraceCount} extra`
  const indices = new Map(
    topology.traces.map(({ sourceTraceId, index }) => [sourceTraceId, index]),
  )
  return [...groups].map(([name, paths], index) => {
    const traces = new Set(
      paths.flatMap(({ pathSegments }) =>
        pathSegments.flatMap((segment) => {
          if (segment.kind === "trace") return [segment.sourceTraceId]
          return []
        }),
      ),
    )
    const first = indices.get([...traces][0])
    let color: string = planColors.ideal
    if (first !== undefined) color = getTraceColor(first)
    const driver = getPinName({ sourcePortId: paths[0].fromSourcePortId, db })
    const receivers = paths
      .map(({ toSourcePortId }) =>
        getPinName({ sourcePortId: toSourcePortId, db }),
      )
      .join(", ")
    const detail = `${formatCount({ count: traces.size, noun: "trace" })}, ${formatTotalLengthMm({ traces, measures })}`
    let text = `${name}: ${driver} → ${receivers} (${detail})`
    if (index === groups.size - 1) text += suffix
    return {
      text,
      color,
    }
  })
}

/** Keep the header legible by summarizing longer paths. */
const MAX_DETAILED_PATH_ROWS = 4

/** List the resolved route, leading with the bypass when one bypasses it. */
export function buildPathRows({
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
  const measures = measureTraces(db)
  if (!topology) return partialRows({ paths, fault, measures, db })
  const bypassRows = fault.overlays
    .filter(({ kind }) => kind === "short")
    .map((link) => {
      const isReversed = paths.some(
        ({ fromSourcePortId, toSourcePortId }) =>
          link.toSourcePortId === fromSourcePortId &&
          link.fromSourcePortId === toSourcePortId,
      )
      if (isReversed)
        return buildPathRow({
          fromSourcePortId: link.toSourcePortId,
          toSourcePortId: link.fromSourcePortId,
          signalName: "Bypass",
          detail: "ideal connection",
          color: planColors.failure,
          db,
        })
      return buildPathRow({
        ...link,
        signalName: "Bypass",
        detail: "ideal connection",
        color: planColors.failure,
        db,
      })
    })
  const extras = orderExtraTraces(topology)
  const rows = buildDetailedRows({ topology, extras, measures, db })
  const limit = MAX_DETAILED_PATH_ROWS
  if (rows.length + bypassRows.length <= limit) return [...bypassRows, ...rows]
  return [
    ...bypassRows,
    ...buildCompactRows({
      topology,
      extraTraceCount: extras.length,
      limit,
      measures,
      db,
    }),
  ]
}
