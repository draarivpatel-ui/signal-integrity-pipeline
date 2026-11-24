import { cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  endpointPorts,
  type PlanVisualCut,
  type PlanVisualLink,
  type PlanVisualScene,
  planColors,
  planPorts,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
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

/** The declaration and original diagnostic captured before the solver reports a failure. */
export interface FailedPlanAttempt {
  simulation: SimulationPcbTransientChannelSimulation
  error: unknown
}

/** A declared driver/receiver pair, keeping differential polarity. */
export interface PlanPath {
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
        let port = name
        if (drivers.length > 1) port += leg === 0 ? " +" : " −"
        return { name: port, from: drivers[leg], to }
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

/** Ordered physical cuts traversed by one driver-to-receiver connection. */
export interface ResolvedPlanPath extends PlanPath {
  traces: SourceTraceId[]
}

/** Orient the route using each physical segment and the intervening ideal node. */
function resolvePaths({
  paths,
  graphs,
  nodes,
}: {
  paths: readonly PlanPath[]
  graphs: ReceiverGraphs
  nodes: CircuitNodes["mapping"]
}): Map<ResolvedPlanPath, Map<SourceTraceId, SourcePortId>> {
  return new Map(
    paths.map((path) => {
      const edges = receiverPath({
        graphs,
        fromSourcePortId: path.from,
        toSourcePortId: path.to,
        allowUnroutedTraces: true,
      })
      const directions = new Map<SourceTraceId, SourcePortId>()
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
        if (sourceTraceId !== undefined) directions.set(sourceTraceId, from)
        current = to
      }
      return [{ ...path, traces: [...directions.keys()] }, directions]
    }),
  )
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
  const groundSourcePortId = selectPort({
    circuit,
    selector: modeling.channelReference,
  }).source_port_id
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
  const directed = resolvePaths({ paths, graphs, nodes })
  const oriented = new Map<SourceTraceId, SourcePortId>()
  for (const directions of directed.values())
    for (const [id, from] of directions)
      if (!oriented.has(id)) oriented.set(id, from)
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
    paths: [...directed.keys()],
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

/** Preserve exact record tokens in diagnostics which predate structured subjects. */
function diagnosticRecords(error: string): Set<string> {
  const records = new Set<string>()
  let token = ""
  for (const char of `${error} `) {
    if (
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(
        char,
      )
    ) {
      token += char
      continue
    }
    if (token.startsWith("source_port_") || token.startsWith("source_trace_"))
      records.add(token)
    token = ""
  }
  return records
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
  message,
  paths,
  topology,
}: {
  issue?: Diagnostic
  message?: string
  paths: readonly PlanPath[]
  topology?: PlanTopology
}): PlanFault {
  const ports = new Set<SourcePortId>()
  const traces = new Set<SourceTraceId>()
  const links: PlanVisualLink[] = []
  if (!message) return { ports, traces, links }
  const ids = diagnosticRecords(message)
  for (const { id } of issue?.subjects || []) ids.add(id)
  for (const id of ids) {
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
}: {
  circuit: CircuitJson
  plan?: TransientChannelSimulationPlan
  failed?: FailedPlanAttempt
  error: string | null
}): PlanVisualScene {
  const db = cju([...circuit])
  const simulationId =
    failed?.simulation.simulation_pcb_transient_channel_simulation_id ||
    plan?.simulationPcbTransientChannelSimulationId
  const name = failed?.simulation.name || plan?.name || simulationId
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
  let message = issue?.message || error || undefined
  if (failed?.error instanceof Error) message = failed.error.message
  const fault = faultGeometry({ issue, message, paths, topology })
  const names = [...fault.ports].flatMap((id) => {
    const label = labels.get(id)
    if (!label) return []
    return [`${id} = ${label}`]
  })
  const diagnostic =
    [message, names.join("  ·  ")].filter(Boolean).join("\n") || undefined
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
  const rows = planLedger({
    paths,
    topology,
    fault,
    labels,
    existingTraces,
    db,
  })
  const refdes = new Map(
    db.source_component
      .list()
      .map((component) => [component.source_component_id, component.name]),
  )
  const components = [
    ...new Set(
      db.pcb_component
        .list()
        .toSorted((a, b) => a.center.x - b.center.x)
        .map((component) => refdes.get(component.source_component_id))
        .filter(Boolean),
    ),
  ]
  if (components.length)
    rows.push({
      text: `Components · ${components.join("  ·  ")}`,
      color: planColors.quiet,
    })
  const nets = new Map(
    db.source_net.list().map((net) => [net.source_net_id, net.name]),
  )
  const pours = [
    ...new Set(
      db.pcb_copper_pour.list().flatMap((pour) => {
        const name = nets.get(pour.source_net_id || "")
        if (!name) return []
        return [`${name} (${pour.layer})`]
      }),
    ),
  ]
  if (pours.length)
    rows.push({
      text: `Pours · ${pours.join("  ·  ")}`,
      color: planColors.quiet,
    })
  let status = "AWAITING PLAN"
  if (failed || error) status = "PLAN FAILED"
  else if (issue) status = "TOPOLOGY CHECK FAILED"
  else if (plan) status = "ADMITTED"
  const parts: string[] = channels.map(({ name }) => name)
  if (topology) {
    const { cuts, segments } = topology
    const contacts = [...topology.paths, ...cuts, ...segments].flatMap(
      ({ from, to }) => [topology.nodes[from], topology.nodes[to]],
    )
    parts.push(
      `${cuts.length} cuts`,
      `${segments.filter(({ kind }) => kind === "series").length} series`,
      `${segments.filter(({ kind }) => kind === "ideal").length} ideal joins`,
      `${new Set(contacts.filter(Boolean)).size} nodes`,
    )
  }
  return {
    db,
    title: [status, name].filter(Boolean).join("  ·  "),
    summary: parts.join("  ·  "),
    diagnostic,
    scope: topology && plan?.sections.copperScope,
    cuts: topology?.cuts || [],
    endpoints: planEndpoints({ paths, topology, labels }),
    links: [...(topology?.segments || []), ...fault.links],
    rows,
    faultPorts: fault.ports,
    faultTraces: fault.traces,
    existingTraces,
  }
}
