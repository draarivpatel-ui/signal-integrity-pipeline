import { cju } from "@tscircuit/circuit-json-util"
import type { SourceTrace } from "circuit-json"
import type {
  CircuitJson,
  CopperScope,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
  SourceNetId,
  SourcePortId,
} from "../board"
import { endpointPorts } from "../board"
import { Diagnostic } from "../kernel"
import type { NumericalSettings, RoutedLane } from "./modeling"
import type { SignalPins } from "./signal-pins"

/** Supported lanes and rejection messages from auditing the scoped copper. */
type RoutedLanes = {
  lanes: NumericalSettings["lanes"]
  rejections: string[]
}

/** Orient the selected trace from its driver when only one end is driven. */
function routedLane({
  trace,
  topology,
  driven,
}: {
  trace: SourceTrace
  topology: ReadonlyMap<SourcePortId | SourceNetId, string>
  driven: ReadonlySet<SourcePortId>
}): RoutedLane {
  const ordered = trace.connected_source_port_ids.toSorted()
  if (driven.has(ordered[1]) && !driven.has(ordered[0])) ordered.reverse()
  const [from, to] = ordered
  const name = topology.get(from) || "passive"
  return {
    port: `${name}_${trace.source_trace_id}`,
    from: { sourcePortId: from },
    to: { sourcePortId: to },
    sourceTraceId: trace.source_trace_id,
  }
}

/** Build lanes and report unsupported routed traces on the channel. */
export function routedLanes({
  circuit,
  channelPcbTraceIds,
  topology,
  driven,
  rails,
}: {
  circuit: CircuitJson
  channelPcbTraceIds: Readonly<CopperScope["channelPcbTraceIds"]>
  topology: Map<SourcePortId | SourceNetId, string>
  driven: Set<SourcePortId>
  rails: Set<SourcePortId | SourceNetId>
}): RoutedLanes {
  const lanes: NumericalSettings["lanes"] = []
  const rejections: string[] = []
  const db = cju([...circuit])
  const traces = db.source_trace.list()
  const pcbTraces = db.pcb_trace.list()
  const sortedTraces = traces.toSorted((a, b) =>
    a.source_trace_id.localeCompare(b.source_trace_id),
  )
  for (const trace of sortedTraces) {
    const ports = trace.connected_source_port_ids
    const pcb = pcbTraces.filter(
      (route) => route.source_trace_id === trace.source_trace_id,
    )
    if (!pcb.some((route) => channelPcbTraceIds.includes(route.pcb_trace_id)))
      continue
    const members = [...ports, ...(trace.connected_source_net_ids ?? [])]
    if (members.some((port) => rails.has(port))) continue
    if (ports.length !== 2 || pcb.length !== 1) {
      const name =
        topology.get(ports[0]) ??
        trace.name ??
        trace.display_name ??
        trace.source_trace_id
      rejections.push(
        `Signal "${name}": branched routes are not supported yet.`,
      )
      continue
    }
    lanes.push(routedLane({ trace, topology, driven }))
  }
  return { lanes, rejections }
}

/** Require routed lanes for all drivers when unrouted traces are disallowed. */
function validateRoutedDrivers({
  channelSimulation,
  driverReceiverChannels,
  lanes,
}: {
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  lanes: NumericalSettings["lanes"]
}): void {
  if (channelSimulation.allow_unrouted_traces) return
  for (const signal of driverReceiverChannels) {
    for (const port of endpointPorts(signal.driver)) {
      if (
        lanes.some(
          (lane) =>
            lane.from.sourcePortId === port || lane.to.sourcePortId === port,
        )
      )
        continue
      throw new Error(`Signal "${signal.name}" is not routed from ${port}.`)
    }
  }
  if (!lanes.length)
    throw new Error(
      "At least one routed conductor is required for routed extraction",
    )
}

/** Validate scoped lanes and order them by stable physical endpoint identity. */
export function prepareRoutedLanes({
  circuit,
  copperScope,
  channelSimulation,
  driverReceiverChannels,
  signalPins,
}: {
  circuit: CircuitJson
  copperScope: CopperScope
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  signalPins: Pick<SignalPins, "topology" | "driven" | "rails">
}): NumericalSettings["lanes"] {
  const { topology, driven, rails } = signalPins
  const { lanes, rejections } = routedLanes({
    circuit,
    channelPcbTraceIds: copperScope.channelPcbTraceIds,
    topology,
    driven: new Set(driven.keys()),
    rails,
  })
  if (rejections.length)
    throw Object.assign(
      new Diagnostic("pipeline", "channel_fanout", rejections[0]),
      { rejections, copperScope },
    )
  validateRoutedDrivers({ channelSimulation, driverReceiverChannels, lanes })
  return lanes.toSorted((a, b) =>
    a.from.sourcePortId.localeCompare(b.from.sourcePortId),
  )
}
