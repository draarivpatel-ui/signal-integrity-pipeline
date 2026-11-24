import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  cloneCircuitJson,
  endpointPorts,
  indexPlanPorts,
  type PlanOverlay,
  type PlanTrace,
  type PlanVisualScene,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
  type SourceTraceId,
} from "../../board"
import { Diagnostic } from "../../kernel"
import {
  type CircuitNodes,
  numberCircuitNodes,
  type ReceiverGraphs,
  receiverGraphs,
  receiverPath,
  validateRoutedNodes,
} from "../../simulation"
import type { TransientChannelSimulationPlan } from "../transient-channel-simulation-plan"
import { resolvePlanFault } from "./fault"
import { buildEndpoints, buildPathRows } from "./rows"
import { describePlanFailure, summarizePlan } from "./summary"

/** The declaration and original diagnostic captured before the solver reports a failure. */
export interface FailedPlanAttempt {
  channelSimulation?: SimulationPcbTransientChannelSimulation
  error: unknown
}

/** A declared driver/receiver pair, keeping differential polarity. */
export interface PlanPath {
  channelName: string
  channelId: SimulationPcbDriverReceiverChannel["simulation_pcb_driver_receiver_channel_id"]
  signalName: string
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
}

/** Resolve one path for each declared receiver leg, even if it never reached binding. */
function listDeclaredPaths(
  channels: readonly SimulationPcbDriverReceiverChannel[],
): PlanPath[] {
  return channels.flatMap(
    ({
      name,
      driver,
      receivers,
      simulation_pcb_driver_receiver_channel_id,
    }) => {
      const drivers = endpointPorts(driver)
      return receivers.flatMap((receiver) =>
        endpointPorts(receiver).map((toSourcePortId, leg) => {
          let signal = name
          if (drivers.length > 1) signal += ["+", "−"][leg]
          return {
            channelName: name,
            channelId: simulation_pcb_driver_receiver_channel_id,
            signalName: signal,
            fromSourcePortId: drivers[leg],
            toSourcePortId,
          }
        }),
      )
    },
  )
}

/** Presentation data for the electrical partitions before rendering the board. */
export interface PlanTopology {
  traces: PlanTrace[]
  paths: ResolvedPlanPath[]
  overlays: PlanOverlay[]
  nodes: CircuitNodes["mapping"]
  issue?: Diagnostic
}

/** One ordered trace, series part, or direct connection between route contacts. */
export type PlanPathSegment = Pick<
  PlanPath,
  "fromSourcePortId" | "toSourcePortId"
> &
  (
    | { kind: "trace"; sourceTraceId: SourceTraceId }
    | { kind: "series" | "ideal" }
  )

/** Ordered hops traversed by one driver-to-receiver connection. */
export interface ResolvedPlanPath extends PlanPath {
  pathSegments: PlanPathSegment[]
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
    fromSourcePortId: path.fromSourcePortId,
    toSourcePortId: path.toSourcePortId,
    allowUnroutedTraces: true,
  })
  const pathSegments: PlanPathSegment[] = []
  let current = path.fromSourcePortId
  for (const {
    fromSourcePortId: firstSourcePortId,
    toSourcePortId: secondSourcePortId,
    sourceTraceId,
  } of edges || []) {
    let fromSourcePortId = firstSourcePortId
    let toSourcePortId = secondSourcePortId
    if (
      current === toSourcePortId ||
      (current !== fromSourcePortId &&
        nodes[current] !== nodes[fromSourcePortId] &&
        nodes[current] === nodes[toSourcePortId])
    ) {
      fromSourcePortId = secondSourcePortId
      toSourcePortId = firstSourcePortId
    }
    if (current !== fromSourcePortId)
      pathSegments.push({
        kind: "ideal",
        fromSourcePortId: current,
        toSourcePortId: fromSourcePortId,
      })
    if (sourceTraceId === undefined)
      pathSegments.push({ kind: "series", fromSourcePortId, toSourcePortId })
    else
      pathSegments.push({
        kind: "trace",
        sourceTraceId,
        fromSourcePortId,
        toSourcePortId,
      })
    current = toSourcePortId
  }
  if (edges && current !== path.toSourcePortId)
    pathSegments.push({
      kind: "ideal",
      fromSourcePortId: current,
      toSourcePortId: path.toSourcePortId,
    })
  return { ...path, pathSegments }
}

/** Draw only relevant series passives and ideal wires, keeping distinct explicit joins. */
function buildTopologyOverlays({
  db,
  graphs,
  activeSourcePortIds,
  placedSourcePortIds,
  nodes,
}: {
  db: CircuitJsonUtilObjects
  graphs: ReceiverGraphs
  activeSourcePortIds: ReadonlySet<SourcePortId>
  placedSourcePortIds: ReadonlySet<SourcePortId>
  nodes: CircuitNodes["mapping"]
}): PlanOverlay[] {
  const overlays: PlanOverlay[] = []
  for (const { evidence } of graphs.channelConnections) {
    if (evidence.sourceTraceId !== undefined) continue
    const { fromSourcePortId, toSourcePortId } = evidence
    overlays.push({
      fromSourcePortId,
      toSourcePortId,
      kind: "series",
      label: "Series passive",
    })
  }
  const active = new Set([
    ...activeSourcePortIds,
    ...overlays.flatMap(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
  ])
  const activeNodes = new Set([...active].map((id) => nodes[id]))
  const netContacts = new Map<string, Set<SourcePortId>>()
  const seen = new Set<string>()
  for (const connection of graphs.wireConnections) {
    const pins = connection.filter(
      (id) =>
        placedSourcePortIds.has(id) &&
        activeNodes.has(nodes[id]) &&
        nodes[id] !== "0",
    )
    const [fromSourcePortId, ...targets] = pins
    for (const toSourcePortId of targets) {
      const key = [fromSourcePortId, toSourcePortId].sort().join(" ")
      if (seen.has(key)) continue
      seen.add(key)
      overlays.push({
        fromSourcePortId,
        toSourcePortId,
        kind: "ideal",
        label: "Ideal connection",
      })
    }
    for (const id of connection) {
      if (!db.source_net.get(id)) continue
      const contacts = netContacts.get(id) || new Set()
      for (const pin of pins) contacts.add(pin)
      netContacts.set(id, contacts)
    }
  }
  for (const [fromSourcePortId, ...targets] of netContacts.values()) {
    for (const toSourcePortId of targets) {
      const key = [fromSourcePortId, toSourcePortId].sort().join(" ")
      if (seen.has(key)) continue
      seen.add(key)
      overlays.push({
        fromSourcePortId,
        toSourcePortId,
        kind: "ideal",
        label: "Ideal net connection",
      })
    }
  }
  return overlays
}

/** Reuse binding's node numbering and validation without changing the resulting plans. */
function resolvePlanTopology({
  plan,
  paths,
  placedSourcePortIds,
}: {
  plan: TransientChannelSimulationPlan
  paths: readonly PlanPath[]
  placedSourcePortIds: ReadonlySet<SourcePortId>
}): PlanTopology {
  const {
    circuitJson: plannedCircuitJson,
    receiverPaths,
    traceContacts,
    modeling,
  } = plan.bindings
  const circuitJson = cloneCircuitJson(plannedCircuitJson)
  const db = cju(circuitJson)
  const channels = db.simulation_pcb_driver_receiver_channel.list()
  const groundSourcePortId = plan.sections.referenceSourcePortId
  const graphs = receiverGraphs({
    db,
    circuit: circuitJson,
    cuts: traceContacts,
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
  for (const { pathSegments } of resolved)
    for (const segment of pathSegments)
      if (segment.kind === "trace" && !oriented.has(segment.sourceTraceId))
        oriented.set(segment.sourceTraceId, segment.fromSourcePortId)
  const traceContactsBySourceTraceId = new Map(
    traceContacts.map((contacts) => [contacts.sourceTraceId, contacts]),
  )
  const orderedSourceTraceIds = new Set([
    ...oriented.keys(),
    ...traceContactsBySourceTraceId.keys(),
  ])
  const visualTraces = [...orderedSourceTraceIds].flatMap(
    (sourceTraceId, index): PlanTrace[] => {
      const contacts = traceContactsBySourceTraceId.get(sourceTraceId)
      if (!contacts) return []
      const mappedFromSourcePortId = oriented.get(sourceTraceId)
      const isMapped = mappedFromSourcePortId !== undefined
      if (mappedFromSourcePortId === contacts.toSourcePortId)
        return [
          {
            ...contacts,
            fromSourcePortId: contacts.toSourcePortId,
            toSourcePortId: contacts.fromSourcePortId,
            index,
            isMapped,
          },
        ]
      return [{ ...contacts, index, isMapped }]
    },
  )
  const activeSourcePortIds = new Set(
    [...paths, ...visualTraces].flatMap(
      ({ fromSourcePortId, toSourcePortId }) => [
        fromSourcePortId,
        toSourcePortId,
      ],
    ),
  )
  const topology: PlanTopology = {
    traces: visualTraces,
    nodes,
    paths: resolved,
    overlays: buildTopologyOverlays({
      db,
      graphs,
      activeSourcePortIds,
      placedSourcePortIds,
      nodes,
    }),
  }
  try {
    validateRoutedNodes({
      cuts: traceContacts,
      receiverPaths,
      graphs,
      channels,
      node,
      isMappingOnly: false,
    })
  } catch (error) {
    if (!(error instanceof Diagnostic)) throw error
    return { ...topology, issue: error }
  }
  return topology
}

/** Select the latest attempted simulation before looking up its own channel declarations. */
export function buildPlanVisualScene({
  circuitJson,
  plan,
  failed,
  error,
  solved,
}: {
  circuitJson: CircuitJson
  plan?: TransientChannelSimulationPlan
  failed?: FailedPlanAttempt
  error: string | null
  solved: boolean
}): PlanVisualScene {
  const db = cju([...circuitJson])
  let simulationPcbTransientChannelSimulationId =
    plan?.simulationPcbTransientChannelSimulationId
  let name = plan?.name
  if (failed) {
    simulationPcbTransientChannelSimulationId =
      failed.channelSimulation?.simulation_pcb_transient_channel_simulation_id
    name = failed.channelSimulation?.name
  }
  let simulationName = name
  if (name === simulationPcbTransientChannelSimulationId)
    simulationName = undefined
  const channels = db.simulation_pcb_driver_receiver_channel
    .list()
    .filter(
      (channel) =>
        channel.simulation_pcb_transient_channel_simulation_id ===
        simulationPcbTransientChannelSimulationId,
    )
  const paths = listDeclaredPaths(channels)
  const ports = indexPlanPorts(db)
  const labels = new Map(
    [...ports].map(([sourcePortId, port]) => [sourcePortId, port.label]),
  )
  let topology: PlanTopology | undefined
  if (plan && !failed)
    topology = resolvePlanTopology({
      plan,
      paths,
      placedSourcePortIds: new Set(ports.keys()),
    })
  let issue = topology?.issue
  if (failed?.error instanceof Diagnostic) issue = failed.error
  const routed = new Set(
    db.pcb_trace.list().map(({ source_trace_id }) => source_trace_id),
  )
  const routedTraces = db.source_trace
    .list()
    .filter(({ source_trace_id }) => routed.has(source_trace_id))
  const partiallyRoutedPorts = new Set(
    routedTraces.flatMap(
      ({ connected_source_port_ids }) => connected_source_port_ids,
    ),
  )
  const fault = resolvePlanFault({
    db,
    issue,
    paths,
    topology,
    partiallyRoutedPorts,
  })
  let message = issue?.message || error
  if (failed?.error instanceof Error) message = failed.error.message
  let diagnostic: PlanVisualScene["diagnostic"]
  if (message)
    diagnostic = {
      text: describePlanFailure({
        issue,
        error: failed?.error,
        paths,
        topology,
        fault,
        db,
      }),
      label: message,
    }
  const pathPorts = new Set(
    paths.flatMap(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
  )
  const existingSourceTraceIds = new Set(
    routedTraces
      .filter(({ connected_source_port_ids }) =>
        connected_source_port_ids.some((port) => pathPorts.has(port)),
      )
      .map(({ source_trace_id }) => source_trace_id),
  )
  const endpoints = buildEndpoints({ paths, topology, labels })
  const copperScope = topology && plan?.sections.copperScope
  let summary: PlanVisualScene["summary"]
  if (!diagnostic && topology)
    summary = summarizePlan({
      topology,
      db,
      nearbyGapMm: copperScope?.nearbyGapMm,
    })
  let title = "Plan: waiting to run"
  if (diagnostic) title = `${simulationName || "Plan"}: can't simulate`
  else if (plan) title = `${simulationName || "Plan"}: ready to simulate`
  else if (solved) title = "Plan: no signals to simulate"
  return {
    db,
    ports,
    title,
    diagnostic,
    copperScope,
    summary,
    traces: topology?.traces || [],
    endpoints,
    overlays: [...(topology?.overlays || []), ...fault.overlays],
    rows: buildPathRows({ topology, paths, fault, db }),
    faultCode: issue?.code,
    faultSourcePortIds: fault.ports,
    faultSourceTraceIds: fault.traces,
    existingSourceTraceIds,
  }
}
