import { cju } from "@tscircuit/circuit-json-util"
import type { PcbTrace, SourceTrace } from "circuit-json"
import type {
  CircuitJson,
  CopperScope,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "../board"
import { endpointPorts } from "../board"
import { Diagnostic } from "../kernel"
import type { ChannelTrace, NumericalSettings } from "./modeling"
import { compareNames } from "./signal-names"
import type { SignalPins } from "./signal-pins"

/** A trace rejected by the scoped copper audit and the reason it was rejected. */
type TraceRejection = { sourceTrace: SourceTrace; message: string }

/** Supported channel traces and rejections from auditing the scoped copper. */
type ChannelTraceAudit = {
  channelTraces: NumericalSettings["channelTraces"]
  rejections: TraceRejection[]
}

/** Orient the selected trace from its driver when only one end is driven. */
function orientChannelTrace({
  trace,
  topology,
  driven,
}: {
  trace: SourceTrace
  topology: ReadonlyMap<SourcePortId | SourceNetId, string>
  driven: ReadonlySet<SourcePortId>
}): ChannelTrace {
  const ordered = trace.connected_source_port_ids.toSorted((a, b) =>
    compareNames({ a, b }),
  )
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
export function auditChannelTraces({
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
}): ChannelTraceAudit {
  const channelTraces: NumericalSettings["channelTraces"] = []
  const rejections: TraceRejection[] = []
  const db = cju([...circuit])
  const selectedPcbTraceIds = new Set(channelPcbTraceIds)
  const pcbTracesBySourceTraceId = new Map<SourceTraceId, PcbTrace[]>()
  for (const pcbTrace of db.pcb_trace.list()) {
    const { source_trace_id: sourceTraceId } = pcbTrace
    if (sourceTraceId === undefined) continue
    const pcbTraces = pcbTracesBySourceTraceId.get(sourceTraceId)
    if (pcbTraces) pcbTraces.push(pcbTrace)
    else pcbTracesBySourceTraceId.set(sourceTraceId, [pcbTrace])
  }
  const sourceTraces = db.source_trace
    .list()
    .toSorted((a, b) =>
      compareNames({ a: a.source_trace_id, b: b.source_trace_id }),
    )
  for (const trace of sourceTraces) {
    const ports = trace.connected_source_port_ids
    const pcbTraces = pcbTracesBySourceTraceId.get(trace.source_trace_id)
    if (
      !pcbTraces?.some(({ pcb_trace_id }) =>
        selectedPcbTraceIds.has(pcb_trace_id),
      )
    )
      continue
    const members = [...ports, ...(trace.connected_source_net_ids ?? [])]
    if (members.some((port) => rails.has(port))) continue
    if (ports.length !== 2 || pcbTraces.length !== 1) {
      const name =
        topology.get(ports[0]) ??
        trace.name ??
        trace.display_name ??
        trace.source_trace_id
      rejections.push({
        sourceTrace: trace,
        message: `Signal "${name}": branched routes are not supported yet.`,
      })
      continue
    }
    channelTraces.push(orientChannelTrace({ trace, topology, driven }))
  }
  return { channelTraces, rejections }
}

/** Require routed lanes for all drivers when unrouted traces are disallowed. */
function validateRoutedDrivers({
  channelSimulation,
  driverReceiverChannels,
  channelTraces,
}: {
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  channelTraces: NumericalSettings["channelTraces"]
}): void {
  if (channelSimulation.allow_unrouted_traces) return
  for (const signal of driverReceiverChannels) {
    for (const port of endpointPorts(signal.driver)) {
      if (
        channelTraces.some(
          (channelTrace) =>
            channelTrace.from.sourcePortId === port ||
            channelTrace.to.sourcePortId === port,
        )
      )
        continue
      throw new Error(`Signal "${signal.name}" is not routed from ${port}.`)
    }
  }
  if (!channelTraces.length)
    throw new Error(
      "At least one routed conductor is required for routed extraction",
    )
}

/** Validate scoped lanes and order them by stable physical endpoint identity. */
export function prepareChannelTraces({
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
}): NumericalSettings["channelTraces"] {
  const { topology, driven, rails } = signalPins
  const { channelTraces, rejections } = auditChannelTraces({
    circuit,
    channelPcbTraceIds: copperScope.channelPcbTraceIds,
    topology,
    driven: new Set(driven.keys()),
    rails,
  })
  const rejection = rejections[0]
  if (rejection) {
    const { source_trace_id, connected_source_port_ids } = rejection.sourceTrace
    throw Object.assign(
      new Diagnostic("pipeline", "channel_fanout", rejection.message, {
        subjects: [source_trace_id, ...connected_source_port_ids].map((id) => ({
          kind: "record",
          id,
        })),
      }),
      { rejections: rejections.map(({ message }) => message), copperScope },
    )
  }
  validateRoutedDrivers({
    channelSimulation,
    driverReceiverChannels,
    channelTraces,
  })
  return channelTraces.toSorted((a, b) =>
    compareNames({ a: a.from.sourcePortId, b: b.from.sourcePortId }),
  )
}
