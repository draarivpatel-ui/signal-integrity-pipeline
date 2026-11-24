import { cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  endpointPorts,
  type PlanVisualCut,
  type PlanVisualLink,
  type PlanVisualScene,
  planPorts,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
  type SourceTraceId,
} from "../board"
import { Diagnostic } from "../kernel"
import {
  type CircuitNodes,
  numberCircuitNodes,
  type ReceiverGraphs,
  receiverGraphs,
  receiverPath,
  validateRoutedNodes,
} from "../simulation"
import type { TransientChannelSimulationPlan } from "./transient-channel-simulation-plan"
import {
  planEndpoints,
  planLedger,
} from "./transient-channel-simulation-plan-ledger"
import {
  planFailure,
  planSummary,
} from "./transient-channel-simulation-plan-summary"

/** The declaration and original diagnostic captured before the solver reports a failure. */
export interface FailedPlanAttempt {
  simulation?: SimulationPcbTransientChannelSimulation
  error: unknown
}

/** A declared driver/receiver pair, keeping differential polarity. */
export interface PlanPath {
  channel: string
  name: string
  from: SourcePortId
  to: SourcePortId
}

/** Resolve one path for each declared receiver leg, even if it never reached binding. */
function planPaths(
  channels: readonly SimulationPcbDriverReceiverChannel[],
): PlanPath[] {
  return channels.flatMap(({ name, driver, receivers }) => {
    const drivers = endpointPorts(driver)
    return receivers.flatMap((receiver) =>
      endpointPorts(receiver).map((to, leg) => {
        let signal = name
        if (drivers.length > 1) signal += ["+", "−"][leg]
        return { channel: name, name: signal, from: drivers[leg], to }
      }),
    )
  })
}

/** Presentation data for the electrical partitions before rendering the board. */
export interface PlanTopology {
  cuts: PlanVisualCut[]
  paths: ResolvedPlanPath[]
  segments: PlanVisualLink[]
  nodes: CircuitNodes["mapping"]
  issue?: Diagnostic
}

/** One ordered trace, series part, or direct connection between route contacts. */
export type PlanHop = Pick<PlanPath, "from" | "to"> &
  ({ kind: "trace"; trace: SourceTraceId } | { kind: "series" | "ideal" })

/** Ordered hops traversed by one driver-to-receiver connection. */
export interface ResolvedPlanPath extends PlanPath {
  hops: PlanHop[]
}

/** Orient each edge and fill jumps between contacts on the same ideal node. */
function resolvePath({
  path,
  graphs,
  nodes,
}: {
  path: PlanPath
  graphs: ReceiverGraphs
  nodes: CircuitNodes["mapping"]
}): ResolvedPlanPath {
  const edges = receiverPath({
    graphs,
    fromSourcePortId: path.from,
    toSourcePortId: path.to,
    allowUnroutedTraces: true,
  })
  const hops: PlanHop[] = []
  let current = path.from
  for (const { fromSourcePortId, toSourcePortId, sourceTraceId } of edges ||
    []) {
    let from = fromSourcePortId
    let to = toSourcePortId
    if (
      current === to ||
      (current !== from &&
        nodes[current] !== nodes[from] &&
        nodes[current] === nodes[to])
    ) {
      from = toSourcePortId
      to = fromSourcePortId
    }
    if (current !== from) hops.push({ kind: "ideal", from: current, to: from })
    if (sourceTraceId === undefined) hops.push({ kind: "series", from, to })
    else hops.push({ kind: "trace", trace: sourceTraceId, from, to })
    current = to
  }
  if (edges && current !== path.to)
    hops.push({ kind: "ideal", from: current, to: path.to })
  return { ...path, hops }
}

/** Draw only relevant series passives and ideal wires, keeping distinct explicit joins. */
function topologyLinks({
  graphs,
  touched,
  placed,
  nodes,
}: {
  graphs: ReceiverGraphs
  touched: ReadonlySet<SourcePortId>
  placed: ReadonlySet<SourcePortId>
  nodes: CircuitNodes["mapping"]
}): PlanVisualLink[] {
  const links: PlanVisualLink[] = []
  for (const { evidence } of graphs.channelConnections) {
    if (evidence.sourceTraceId !== undefined) continue
    const { fromSourcePortId: from, toSourcePortId: to } = evidence
    links.push({ from, to, kind: "series", label: "Series passive" })
  }
  const active = new Set([
    ...touched,
    ...links.flatMap(({ from, to }) => [from, to]),
  ])
  const activeNodes = new Set([...active].map((id) => nodes[id]))
  const netContacts = new Map<string, Set<SourcePortId>>()
  const seen = new Set<string>()
  for (const connection of graphs.wireConnections) {
    const pins = connection.filter(
      (id) => placed.has(id) && activeNodes.has(nodes[id]) && nodes[id] !== "0",
    )
    const [from, ...targets] = pins
    for (const to of targets) {
      const key = [from, to].sort().join(" ")
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ from, to, kind: "ideal", label: "Ideal join" })
    }
    for (const id of connection) {
      if (!id.startsWith("source_net_")) continue
      const contacts = netContacts.get(id) || new Set()
      for (const pin of pins) contacts.add(pin)
      netContacts.set(id, contacts)
    }
  }
  for (const [from, ...targets] of netContacts.values()) {
    for (const to of targets) {
      const key = [from, to].sort().join(" ")
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ from, to, kind: "ideal", label: "Ideal net join" })
    }
  }
  return links
}

/** Reuse binding's node numbering and validation without changing the resulting plans. */
function planTopology({
  plan,
  paths,
  placed,
}: {
  plan: TransientChannelSimulationPlan
  paths: readonly PlanPath[]
  placed: ReadonlySet<SourcePortId>
}): PlanTopology {
  const {
    circuitJson: circuit,
    mappings,
    routedTraceCuts: cuts,
    modeling,
  } = plan.bindings
  const db = cju([...circuit])
  const channels = db.simulation_pcb_driver_receiver_channel.list()
  const groundSourcePortId = plan.sections.referenceSourcePortId
  const graphs = receiverGraphs({
    db,
    circuit,
    cuts,
    channels,
    groundSourcePortId,
    modeling,
  })
  const { mapping: nodes, node } = numberCircuitNodes({
    db,
    graphs,
    groundSourcePortId,
  })
  const resolved = paths.map((path) => resolvePath({ path, graphs, nodes }))
  const oriented = new Map<SourceTraceId, SourcePortId>()
  for (const { hops } of resolved)
    for (const hop of hops)
      if (hop.kind === "trace" && !oriented.has(hop.trace))
        oriented.set(hop.trace, hop.from)
  const cutOrder = new Map(
    [
      ...oriented.keys(),
      ...cuts
        .filter((cut) => !oriented.has(cut.sourceTraceId))
        .map((cut) => cut.sourceTraceId),
    ].map((id, index) => [id, index]),
  )
  const visualCuts = cuts.map(
    (
      { sourceTraceId: trace, fromSourcePortId, toSourcePortId },
      defaultIndex,
    ): PlanVisualCut => {
      const index = cutOrder.get(trace)
      const cutIndex = index === undefined ? defaultIndex : index
      const mappedFrom = oriented.get(trace)
      if (mappedFrom === toSourcePortId)
        return {
          trace,
          from: toSourcePortId,
          to: fromSourcePortId,
          index: cutIndex,
          mapped: true,
        }
      return {
        trace,
        from: fromSourcePortId,
        to: toSourcePortId,
        index: cutIndex,
        mapped: mappedFrom !== undefined,
      }
    },
  )
  const touched = new Set(
    [...paths, ...visualCuts].flatMap(({ from, to }) => [from, to]),
  )
  const topology: PlanTopology = {
    cuts: visualCuts.sort((a, b) => a.index - b.index),
    nodes,
    paths: resolved,
    segments: topologyLinks({ graphs, touched, placed, nodes }),
  }
  try {
    validateRoutedNodes({
      cuts,
      mappings,
      graphs,
      channels,
      node,
      mappingOnly: false,
    })
  } catch (error) {
    if (!(error instanceof Diagnostic)) throw error
    return { ...topology, issue: error }
  }
  return topology
}

/** Fault ports and routes are selected only from the current attempt's evidence. */
export interface PlanFault {
  ports: Set<SourcePortId>
  traces: Set<SourceTraceId>
  links: PlanVisualLink[]
}

/** Diagnose open legs and collapsed or bypassed connections from the evidence. */
function faultGeometry({
  issue,
  paths,
  topology,
}: {
  issue?: Diagnostic
  paths: readonly PlanPath[]
  topology?: PlanTopology
}): PlanFault {
  const ports = new Set<SourcePortId>()
  const traces = new Set<SourceTraceId>()
  const links: PlanVisualLink[] = []
  for (const { id, kind } of issue?.subjects || []) {
    if (kind !== "record") continue
    if (id.startsWith("source_port_")) ports.add(id)
    if (id.startsWith("source_trace_")) traces.add(id)
  }
  if (issue?.code === "channel_short") {
    for (const link of topology?.segments || []) {
      if (link.kind !== "ideal" || !ports.has(link.from) || !ports.has(link.to))
        continue
      links.push({ ...link, kind: "short", label: "Ideal bypass" })
    }
  } else if (
    issue?.code === "channel_net" ||
    issue?.code === "channel_receiver_terminal_missing"
  ) {
    for (const { name, from, to } of paths)
      if (ports.has(from) && ports.has(to))
        links.push({
          from,
          to,
          kind: "missing",
          label: `${name} · No routed source path`,
        })
  }
  return { ports, traces, links }
}

/** Select the latest attempted simulation before looking up its own channel declarations. */
export function buildPlanVisualScene({
  circuit,
  plan,
  failed,
  error,
  solved,
}: {
  circuit: CircuitJson
  plan?: TransientChannelSimulationPlan
  failed?: FailedPlanAttempt
  error: string | null
  solved: boolean
}): PlanVisualScene {
  const db = cju([...circuit])
  const simulationId =
    failed?.simulation?.simulation_pcb_transient_channel_simulation_id ||
    plan?.simulationPcbTransientChannelSimulationId
  const name = failed?.simulation?.name || plan?.name
  const simulationName = name === simulationId ? undefined : name
  const channels = db.simulation_pcb_driver_receiver_channel
    .list()
    .filter(
      (channel) =>
        channel.simulation_pcb_transient_channel_simulation_id === simulationId,
    )
  const paths = planPaths(channels)
  const ports = planPorts(db)
  const labels = new Map([...ports].map(([id, port]) => [id, port.label]))
  const topology =
    plan && !failed
      ? planTopology({ plan, paths, placed: new Set(ports.keys()) })
      : undefined
  const issue =
    failed?.error instanceof Diagnostic ? failed.error : topology?.issue
  const fault = faultGeometry({ issue, paths, topology })
  const message =
    failed?.error instanceof Error
      ? failed.error.message
      : issue?.message || error
  let diagnostic: PlanVisualScene["diagnostic"]
  if (message)
    diagnostic = {
      text: planFailure({
        issue,
        error: failed?.error,
        paths,
        topology,
        fault,
        db,
      }),
      label: message,
    }
  const traces = new Map(
    db.source_trace.list().map((trace) => [trace.source_trace_id, trace]),
  )
  const routed = new Set(
    db.pcb_trace.list().map((trace) => trace.source_trace_id),
  )
  const existingTraces = new Set(
    paths.flatMap(({ from, to }) =>
      [...routed].filter((id): id is SourceTraceId => {
        if (id === undefined) return false
        const pins = traces.get(id)?.connected_source_port_ids
        return pins?.includes(from) === true || pins?.includes(to) === true
      }),
    ),
  )
  const endpoints = planEndpoints({ paths, topology, labels })
  const scope = topology && plan?.sections.copperScope
  let summary: PlanVisualScene["summary"]
  if (!diagnostic && topology)
    summary = planSummary({ topology, db, gap: scope?.nearbyGapMm })
  let title = "Plan: waiting to run"
  if (diagnostic) title = `${simulationName || "Plan"}: can't simulate`
  else if (plan) title = `${simulationName || "Plan"}: ready to simulate`
  else if (solved) title = "Plan: no signals to simulate"
  return {
    db,
    title,
    diagnostic,
    scope,
    summary,
    cuts: topology?.cuts || [],
    endpoints,
    links: [...(topology?.segments || []), ...fault.links],
    rows: planLedger({ topology, paths, fault, db }),
    faultCode: issue?.code,
    faultPorts: fault.ports,
    faultTraces: fault.traces,
    existingTraces,
  }
}
