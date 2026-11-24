import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import { type PlanVisualScene, pinName, type SourcePortId } from "../board"
import type { Diagnostic } from "../kernel"
import {
  pinPart,
  planCount,
  planExtraTraces,
  planHopKey,
  planMillimeters,
  seriesPart,
} from "./transient-channel-simulation-plan-ledger"
import type {
  PlanFault,
  PlanPath,
  PlanTopology,
} from "./transient-channel-simulation-plan-visual"

/** Join names or quantities as they would appear in a sentence. */
function joinParts(parts: readonly string[]): string {
  if (parts.length <= 2) return parts.join(" and ")
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
}

/** Choose the final clause that explains how the diagram includes extra copper. */
function extraText({
  topology,
  db,
}: {
  topology: PlanTopology
  db: CircuitJsonUtilObjects
}): string {
  const extras = planExtraTraces(topology)
  if (!extras.length) return ""
  if (extras.length > 1) return `; ${extras.length} extra traces are included.`
  const part = pinPart({ id: extras[0].to, db })?.name
  if (part) return `; 1 extra trace to ${part} is included.`
  return "; 1 extra trace is included."
}

/** Summarize the signal routes and provide scope wording for a cropped copper area. */
export function planSummary({
  topology,
  db,
  gap,
}: {
  topology: PlanTopology
  db: CircuitJsonUtilObjects
  gap?: number
}): PlanVisualScene["summary"] {
  const signals = [...new Set(topology.paths.map(({ channel }) => channel))]
  if (!signals.length) return
  const receivers = [
    ...new Set(
      topology.paths.map(
        ({ to }) => pinPart({ id: to, db })?.name || pinName({ id: to, db }),
      ),
    ),
  ]
  const hops = [
    ...new Map(
      topology.paths.flatMap(({ hops }) =>
        hops.map((hop) => [planHopKey(hop), hop]),
      ),
    ).values(),
  ]
  const traces = hops.filter(({ kind }) => kind === "trace").length
  const series = hops.filter(({ kind }) => kind === "series")
  const direct = hops.filter(({ kind }) => kind === "ideal").length
  const phrases: string[] = []
  if (traces) phrases.push(planCount({ count: traces, noun: "trace" }))
  if (series.length === 1)
    phrases.push(`series ${seriesPart({ from: series[0].from, db })}`)
  else if (series.length)
    phrases.push(planCount({ count: series.length, noun: "series part" }))
  if (direct)
    phrases.push(planCount({ count: direct, noun: "direct connection" }))

  let headline = `${signals.length} signals reach ${planCount({ count: receivers.length, noun: "receiver" })}`
  let route = ` across ${planCount({ count: traces, noun: "trace" })}`
  if (series.length || direct) route = ` through ${joinParts(phrases)}`
  if (signals.length === 1) {
    let targets = planCount({ count: receivers.length, noun: "receiver" })
    if (receivers.length <= 2) targets = joinParts(receivers)
    headline = `${signals[0]} reaches ${targets}`
    route = ""
    if (phrases.length) route = ` through ${joinParts(phrases)}`
  }
  const extras = extraText({ topology, db })
  if (signals.length === 1) headline += route
  if (extras) return { text: headline + extras }
  const summary = { text: `${headline}.` }
  if (signals.length > 1) summary.text = `${headline}${route}.`
  if (gap === undefined) return summary
  return {
    ...summary,
    scopedText: `${headline}; nearby copper within ${planMillimeters(gap)} is included.`,
  }
}

/** Use a reference designator for the summary, with the pin as its fallback. */
function partOrPin({
  id,
  db,
}: {
  id: SourcePortId
  db: CircuitJsonUtilObjects
}): string {
  return pinPart({ id, db })?.name || pinName({ id, db })
}

/** Describe the traces and series parts the shortcut crosses. */
function shortcutSummary({
  from,
  to,
  paths,
  topology,
  fault,
  db,
}: {
  from: SourcePortId
  to: SourcePortId
  paths: readonly PlanPath[]
  topology?: PlanTopology
  fault: PlanFault
  db: CircuitJsonUtilObjects
}): string {
  const route = topology?.paths.find(({ hops }) =>
    [from, to].every((id) =>
      hops.some((hop) => hop.from === id || hop.to === id),
    ),
  )
  const path =
    paths.find((path) => path.from === from && path.to === to) ||
    paths.find((path) => path.from === to && path.to === from) ||
    route
  const contacts = new Set(
    topology?.cuts
      .filter(({ trace }) => fault.traces.has(trace))
      .flatMap(({ from, to }) => [from, to]),
  )
  const series =
    topology?.segments.filter(
      (link) =>
        link.kind === "series" &&
        [link.from, link.to].every(
          (id) => contacts.has(id) || fault.ports.has(id),
        ),
    ) || []
  const skipped = series.map(({ from }) => {
    if (fault.traces.size) return partOrPin({ id: from, db })
    return seriesPart({ from, db })
  })
  if (fault.traces.size === 1) skipped.push("the trace")
  else if (fault.traces.size === 2) skipped.push("both traces")
  else if (fault.traces.size > 2) skipped.push(`${fault.traces.size} traces`)
  let start = from
  let end = to
  if (path?.from === to) [start, end] = [to, from]
  const text = `${path?.name || "The signal"} has a direct shortcut from ${partOrPin({ id: start, db })} to ${partOrPin({ id: end, db })}`
  if (!skipped.length) return `${text}.`
  return `${text}, skipping ${joinParts(skipped)}.`
}

/** State the problem supported by the diagnostic's board and path evidence. */
export function planFailure({
  issue,
  error,
  paths,
  topology,
  fault,
  db,
}: {
  issue?: Diagnostic
  error: unknown
  paths: readonly PlanPath[]
  topology?: PlanTopology
  fault: PlanFault
  db: CircuitJsonUtilObjects
}): string {
  if (error instanceof Error && error.cause === "scopeDistanceMm")
    return "Copper search distance must be greater than 0 mm."
  const missing = fault.links.find(({ kind }) => kind === "missing")
  const path = paths.find(
    ({ from, to }) => missing?.from === from && missing?.to === to,
  )
  if (path) {
    const { from, to, name } = path
    const fromPart = pinPart({ id: from, db })?.name
    const toPart = pinPart({ id: to, db })?.name
    if (issue?.code === "channel_receiver_terminal_missing")
      return `${pinName({ id: to, db })} has no board pad to receive ${name} from ${partOrPin({ id: from, db })}.`
    if (fromPart && toPart && fromPart !== toPart)
      return `${name} has no copper trace between ${fromPart} and ${toPart}.`
    return `${name} has no copper trace from ${pinName({ id: from, db })} to ${pinName({ id: to, db })}.`
  }
  const pins = [...fault.ports]
  const names = pins.map((id) => pinName({ id, db }))
  if (issue?.code === "channel_driver_terminal_missing" && names.length) {
    const driver = paths.find(({ from }) => fault.ports.has(from))
    return `${names[0]} has no board pad to drive ${driver?.name || "the signal"}.`
  }
  if (issue?.code === "channel_fanout" && fault.traces.size) {
    const parts = new Set(pins.map((id) => partOrPin({ id, db })))
    return `Traces through ${[...parts].join(", ")} form a loop.`
  }
  if (issue?.code === "channel_fanout" && names.length)
    return `Route from ${names[0]} branches; only a single path is supported.`
  if (issue?.code === "channel_short") {
    const grounded = pins.find((id) => topology?.nodes[id] === "0")
    if (grounded)
      return `${pinName({ id: grounded, db })} is shorted to ground.`
    const bypass = fault.links.find(({ kind }) => kind === "short")
    if (bypass)
      return shortcutSummary({ ...bypass, paths, topology, fault, db })
    if (names.length === 2)
      return `${names.join(" and ")} are shorted together.`
    if (names.length) return `Short found at ${names.join(", ")}.`
  }
  return "Simulation setup could not be planned; check the board and settings."
}
