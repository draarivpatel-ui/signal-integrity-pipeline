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
  type SourceNetId,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
} from "../../board"
import { Diagnostic } from "../../kernel"
import {
  buildReceiverGraphs,
  type CircuitNodes,
  extractedNonrailSourceTraceIds,
  findReceiverPath,
  numberCircuitNodes,
  type ReceiverGraphs,
  validateRoutedNodes,
} from "../../simulation"
import type { TransientChannelSimulationPlan } from "../transient-channel-simulation-plan"
import { buildEndpoints } from "./endpoints"
import { resolvePlanFault } from "./fault"
import { buildPathRows } from "./rows"
import { buildSceneDiagnostic, summarizePlan } from "./summary"

/** The declaration and original diagnostic captured before the solver reports a failure. */
export interface FailedPlanAttempt {
  channelSimulation?: SimulationPcbTransientChannelSimulation
  error: unknown
}

/** A declared driver/receiver pair, keeping differential polarity. */
export interface PlanPath {
  channelName: string
  simulationPcbDriverReceiverChannelId: SimulationPcbDriverReceiverChannel["simulation_pcb_driver_receiver_channel_id"]
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
            simulationPcbDriverReceiverChannelId:
              simulation_pcb_driver_receiver_channel_id,
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
  spiceNodeNamesBySourceContactId: CircuitNodes["mapping"]
  issue?: Diagnostic
}

/** One ordered trace, series part, or ideal connection between route contacts. */
export type PlanPathSegment = Pick<
  PlanPath,
  "fromSourcePortId" | "toSourcePortId"
> &
  (
    | { kind: "trace"; sourceTraceId: SourceTraceId }
    | { kind: "series" | "ideal" }
  )

/** Ordered segments traversed by one driver-to-receiver connection. */
export interface ResolvedPlanPath extends PlanPath {
  pathSegments: PlanPathSegment[]
}

/** Orient each edge and fill jumps between contacts on the same ideal node. */
function resolvePath({
  path,
  graphs,
  spiceNodeNamesBySourceContactId,
}: {
  path: PlanPath
  graphs: ReceiverGraphs
  spiceNodeNamesBySourceContactId: CircuitNodes["mapping"]
}): ResolvedPlanPath {
  const edges = findReceiverPath({
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
        spiceNodeNamesBySourceContactId[current] !==
          spiceNodeNamesBySourceContactId[fromSourcePortId] &&
        spiceNodeNamesBySourceContactId[current] ===
          spiceNodeNamesBySourceContactId[toSourcePortId])
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
  spiceNodeNamesBySourceContactId,
}: {
  db: CircuitJsonUtilObjects
  graphs: ReceiverGraphs
  activeSourcePortIds: ReadonlySet<SourcePortId>
  placedSourcePortIds: ReadonlySet<SourcePortId>
  spiceNodeNamesBySourceContactId: CircuitNodes["mapping"]
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
  const overlaySourcePortIds = new Set([
    ...activeSourcePortIds,
    ...overlays.flatMap(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
  ])
  const activeSpiceNodeNames = new Set(
    [...overlaySourcePortIds].map(
      (sourcePortId) => spiceNodeNamesBySourceContactId[sourcePortId],
    ),
  )
  const sourcePortIdsBySourceNetId = new Map<SourceNetId, Set<SourcePortId>>()
  const seen = new Set<string>()
  for (const connection of graphs.wireConnections) {
    const pins = connection.filter(
      (sourcePortId) =>
        placedSourcePortIds.has(sourcePortId) &&
        activeSpiceNodeNames.has(
          spiceNodeNamesBySourceContactId[sourcePortId],
        ) &&
        spiceNodeNamesBySourceContactId[sourcePortId] !== "0",
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
    for (const sourceContactId of connection) {
      const sourceNet = db.source_net.get(sourceContactId)
      if (!sourceNet) continue
      const sourceNetId = sourceNet.source_net_id
      const sourcePortIds =
        sourcePortIdsBySourceNetId.get(sourceNetId) || new Set()
      for (const sourcePortId of pins) sourcePortIds.add(sourcePortId)
      sourcePortIdsBySourceNetId.set(sourceNetId, sourcePortIds)
    }
  }
  for (const [
    fromSourcePortId,
    ...targets
  ] of sourcePortIdsBySourceNetId.values()) {
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
  const groundSourcePortId = selectPort({
    circuit: circuitJson,
    selector: modeling.channelReference,
  }).source_port_id
  const graphs = buildReceiverGraphs({
    db,
    circuit: circuitJson,
    traceContacts,
    additionalSourceTraceIds: extractedNonrailSourceTraceIds({
      db,
      copperScope: plan.sections.copperScope,
    }),
    channels,
    groundSourcePortId,
    modeling,
  })
  const { mapping: spiceNodeNamesBySourceContactId, node } = numberCircuitNodes(
    {
      db,
      graphs,
      groundSourcePortId,
    },
  )
  const resolved = paths.map((path) =>
    resolvePath({ path, graphs, spiceNodeNamesBySourceContactId }),
  )
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
      const pathFromSourcePortId = oriented.get(sourceTraceId)
      const isOnReceiverPath = pathFromSourcePortId !== undefined
      if (pathFromSourcePortId === contacts.toSourcePortId)
        return [
          {
            ...contacts,
            fromSourcePortId: contacts.toSourcePortId,
            toSourcePortId: contacts.fromSourcePortId,
            index,
            isOnReceiverPath,
          },
        ]
      return [{ ...contacts, index, isOnReceiverPath }]
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
    spiceNodeNamesBySourceContactId,
    paths: resolved,
    overlays: buildTopologyOverlays({
      db,
      graphs,
      activeSourcePortIds,
      placedSourcePortIds,
      spiceNodeNamesBySourceContactId,
    }),
  }
  try {
    validateRoutedNodes({
      traceContacts,
      receiverPaths,
      graphs,
      channels,
      node,
      hasImplicitTraceContacts: false,
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
  const routedSourceTraceIds = new Set(
    db.pcb_trace.list().map(({ source_trace_id }) => source_trace_id),
  )
  const routedTraces = db.source_trace
    .list()
    .filter(({ source_trace_id }) => routedSourceTraceIds.has(source_trace_id))
  const partiallyRoutedSourcePortIds = new Set(
    routedTraces.flatMap(
      ({ connected_source_port_ids }) => connected_source_port_ids,
    ),
  )
  const fault = resolvePlanFault({
    db,
    issue,
    paths,
    topology,
    partiallyRoutedSourcePortIds,
  })
  const diagnostic = buildSceneDiagnostic({
    error,
    failed,
    issue,
    paths,
    topology,
    fault,
    db,
  })
  const pathSourcePortIds = new Set(
    paths.flatMap(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
  )
  const existingSourceTraceIds = new Set(
    routedTraces
      .filter(({ connected_source_port_ids }) =>
        connected_source_port_ids.some((port) => pathSourcePortIds.has(port)),
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
  let traceFaultKind: PlanVisualScene["traceFaultKind"]
  if (issue?.code === "channel_fanout") {
    traceFaultKind = "loop"
    if ("rejections" in issue) traceFaultKind = "branch"
  }
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
    traceFaultKind,
    faultSourcePortIds: fault.sourcePortIds,
    faultSourceTraceIds: fault.sourceTraceIds,
    existingSourceTraceIds,
  }
}
