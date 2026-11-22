/* eslint-disable local/max-file-lines -- Keep the preparation steps and their validation together. */
import { cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  type ConnectivityMap,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  type SignalEndpoint,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SimulationPcbTransientChannelSimulationId,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
  stackupFromCircuitJson,
} from "../board"
import {
  edgeDurationSeconds,
  type IbisSources,
  type InspectedPin,
  inspectPins,
  pinCapabilities,
} from "../buffers"
import { Diagnostic, safeId } from "../kernel"
import { type RunControls, voltageSourceTerminals } from "../simulation"
import type { NumericalSettings } from "./modeling"
import {
  channelSimulationDurationSeconds,
  endpointPorts,
  withChannelSimulationControls,
} from "./signal-controls"
import { withChannelSimulationSupplies } from "./supplies"
import { signalTopology, validateSignalGraph } from "./topology"

export { endpointPorts, probeEndpoints, signalBits } from "./signal-controls"

/** Maximum and default lateral search distance for routed admission, in millimetres. */
const MAX_COPPER_SCOPE_DISTANCE_MM = 32

/** Set the maximum transient step relative to the shortest bit. */
const STEPS_PER_BIT = 100

/** Set the maximum transient step relative to the fastest edge. */
const STEPS_PER_EDGE = 20

/** Ensure the maximum step is strictly shorter than the recording. */
const MIN_STEPS_PER_RECORDING = 2

/** Simulation records needed while lowering one selected channel simulation. */
const PART_MODEL_RECORD_TYPES = [
  "simulation_ibis_model",
  "simulation_voltage_source",
  "simulation_spice_subcircuit",
]

/** Source component variants with a functional model type and component ID. */
type SourceComponent = Extract<
  CircuitJson[number],
  { type: "source_component" }
>

/** Named source ports and nets electrically connected to channel simulation reference or power rails. */
type RailIds = Set<SourcePortId | SourceNetId>

/** Ports and nets with a node supplied by routed copper, a buffer, or a voltage source. */
type LoadNodeIds = Set<SourcePortId | SourceNetId>

/** Driver pins, named nets and edge times from validated channel endpoints. */
interface SignalIndex {
  driven: Map<SourcePortId, SimulationPcbDriverReceiverChannel>
  topology: Map<SourcePortId | SourceNetId, string>
  edgeTimesSeconds: number[]
}

interface SignalIndexOptions {
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  pins: Map<SourcePortId, InspectedPin>
  signalConnectivity: ConnectivityMap
}

/** The lowered circuit and controls for a single transient channel simulation. */
export interface PreparedChannelSimulation {
  durationSeconds: number
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  circuit: CircuitJson
  controls: Record<string, RunControls>
  pins: Map<SourcePortId, InspectedPin>
  settings: NumericalSettings
}
/** Supported lanes and rejection messages from auditing the scoped copper. */
type RoutedLanes = {
  lanes: NumericalSettings["lanes"]
  rejections: string[]
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
  traces.sort((a, b) => a.source_trace_id.localeCompare(b.source_trace_id))
  for (const trace of traces) {
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
    const ordered = [...ports].sort()
    if (driven.has(ordered[1]) && !driven.has(ordered[0])) ordered.reverse()
    const [from, to] = ordered
    const name = topology.get(from) || "passive"
    lanes.push({
      port: `${name}_${trace.source_trace_id}`,
      from: { sourcePortId: from },
      to: { sourcePortId: to },
      sourceTraceId: trace.source_trace_id,
    })
  }
  return { lanes, rejections }
}
/** Validate the shared channel simulation namespace before any independent channel simulation work. */
export function listChannelSimulations(
  circuitJson: CircuitJson,
): SimulationPcbTransientChannelSimulation[] {
  const db = cju([...circuitJson])
  const channelSimulations =
    db.simulation_pcb_transient_channel_simulation.list()
  if (
    channelSimulations.length > 1 &&
    channelSimulations.some((channelSimulation) => !channelSimulation.name)
  ) {
    const element = "<simulation.pcbtransientchannelsimulation>"
    throw new Error(
      `This board has ${channelSimulations.length} ${element} declarations; give each a name.`,
    )
  }
  const simulationPcbTransientChannelSimulationIds = new Set(
    channelSimulations.map(
      (channelSimulation) =>
        channelSimulation.simulation_pcb_transient_channel_simulation_id,
    ),
  )
  if (
    simulationPcbTransientChannelSimulationIds.size !==
    channelSimulations.length
  )
    throw new Error(
      "Duplicate simulation_pcb_transient_channel_simulation identifier",
    )
  for (const signal of db.simulation_pcb_driver_receiver_channel.list()) {
    if (
      simulationPcbTransientChannelSimulationIds.has(
        signal.simulation_pcb_transient_channel_simulation_id,
      )
    )
      continue
    throw new Error(`${signal.name}: unknown transient channel simulation`)
  }
  return channelSimulations
}
/** Validate one channel simulation and lower its test intent to the private routed declarations. */
export function prepareChannelSimulationById({
  circuit,
  sources,
  simulationPcbTransientChannelSimulationId,
  distanceMm = MAX_COPPER_SCOPE_DISTANCE_MM,
}: {
  circuit: CircuitJson
  sources: IbisSources
  simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
  distanceMm?: number
}): PreparedChannelSimulation {
  if (
    !Number.isFinite(distanceMm) ||
    distanceMm <= 0 ||
    distanceMm > MAX_COPPER_SCOPE_DISTANCE_MM
  ) {
    throw new Error(
      `Copper scope distance must be in (0,${MAX_COPPER_SCOPE_DISTANCE_MM}] mm`,
    )
  }
  const channelSimulations = listChannelSimulations(circuit)
  const matches = channelSimulations.filter(
    (channelSimulation) =>
      channelSimulation.simulation_pcb_transient_channel_simulation_id ===
      simulationPcbTransientChannelSimulationId,
  )
  if (matches.length !== 1)
    throw new Error(
      `Expected exactly one transient channel simulation ${simulationPcbTransientChannelSimulationId}`,
    )
  return prepareChannelSimulation({
    boardCircuitJson: circuit,
    channelSimulation: matches[0],
    sources,
    distanceMm,
  })
}
/** Selected IBIS model for a single-ended pin or one ordered differential leg. */
function selectedIbisModel({
  endpoint,
  index,
}: {
  endpoint: SignalEndpoint
  index: number
}): string | undefined {
  if ("source_port_id" in endpoint) return endpoint.ibis_model_name
  if (index === 0) return endpoint.p_ibis_model_name
  return endpoint.n_ibis_model_name
}

/** Unicode code point order, independent of locale and UTF-16 surrogate ordering. */
export function compareNames({ a, b }: { a: string; b: string }): number {
  const left = Array.from(a, (character) => character.codePointAt(0)!)
  const right = Array.from(b, (character) => character.codePointAt(0)!)
  const sharedLength = Math.min(left.length, right.length)
  for (let i = 0; i < sharedLength; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return left.length - right.length
}

/** Copy the IBIS model records with each endpoint's model choice applied to its pins. */
function withIbisModelOverrides({
  circuit,
  driverReceiverChannels,
}: {
  circuit: CircuitJson
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
}): CircuitJson {
  const modelNameBySourcePortId = new Map<SourcePortId, string>()
  for (const signal of driverReceiverChannels) {
    for (const endpoint of [signal.driver, ...signal.receivers]) {
      for (const [index, sourcePortId] of endpointPorts(endpoint).entries()) {
        const modelName = selectedIbisModel({ endpoint, index })
        if (modelName !== undefined)
          modelNameBySourcePortId.set(sourcePortId, modelName)
      }
    }
  }
  return circuit.map((record) => {
    if (record.type !== "simulation_ibis_model") return record
    const overrides = Object.entries(
      record.ibis_pin_name_to_source_port_id,
    ).flatMap(([pin, sourcePortId]) => {
      const modelName = modelNameBySourcePortId.get(sourcePortId)
      if (modelName === undefined) return []
      return [[pin, modelName] as const]
    })
    if (!overrides.length) return record
    return {
      ...record,
      ibis_pin_name_to_model_name: {
        ...record.ibis_pin_name_to_model_name,
        ...Object.fromEntries(overrides),
      },
    }
  })
}

/** Collect all ports and nets tied to declared rails or to IBIS reference pins. */
function collectRailIds({
  circuit,
  connectivity,
  pins,
}: {
  circuit: CircuitJson
  connectivity: ConnectivityMap
  pins: Map<SourcePortId, InspectedPin>
}): RailIds {
  const railIds: RailIds = new Set()
  const db = cju([...circuit])
  const sourceNets = db.source_net.list()
  const supplyNetIds = sourceNets
    .filter((net) => net.is_ground || net.is_power)
    .map((net) => net.source_net_id)
  const pinReferences = [...pins.values()].flatMap((pin) =>
    Object.values(pin.references),
  )
  const explicit = db.simulation_ibis_model
    .list()
    .flatMap((model) =>
      Object.values(
        model.ibis_pin_name_to_reference_source_port_ids ?? {},
      ).flatMap(Object.values),
    )
  for (const port of [...pinReferences, ...explicit, ...supplyNetIds]) {
    if (port === undefined || railIds.has(port)) continue
    for (const connected of sourceNetMembers({ connectivity, memberId: port }))
      railIds.add(connected)
  }
  return railIds
}

/** A routed signal component can use a built-in passive or an explicit SPICE subcircuit. */
function hasSupportedComponentModel({
  component,
  circuit,
}: {
  component: SourceComponent | undefined
  circuit: CircuitJson
}): boolean {
  if (!component) return false
  if (
    ["simple_resistor", "simple_capacitor", "simple_inductor"].includes(
      component.ftype,
    )
  )
    return true
  return Boolean(
    cju([...circuit]).simulation_spice_subcircuit.getWhere({
      source_component_id: component.source_component_id,
    }),
  )
}

/** Check driver and receiver IBIS roles and index the selected copper nets. */
function indexDriverReceiverChannels({
  driverReceiverChannels,
  pins,
  signalConnectivity,
}: SignalIndexOptions): SignalIndex {
  const driven = new Map<SourcePortId, SimulationPcbDriverReceiverChannel>()
  const topology = new Map<SourcePortId | SourceNetId, string>()
  const edgeTimesSeconds: number[] = []
  for (const signal of driverReceiverChannels) {
    safeId({
      raw: signal.simulation_pcb_driver_receiver_channel_id,
      field: "simulationPcbDriverReceiverChannelId",
    })
    const drivers = endpointPorts(signal.driver)
    const label = `Signal "${signal.name}"`
    for (const port of drivers) {
      const pin = pins.get(port)
      if (!pin)
        throw new Error(
          `${label} driver ${port} has no <simulation.ibismodel>.`,
        )
      const capabilities = pinCapabilities(pin)
      if (!capabilities.drive) {
        throw new Error(
          `${label}: selected IBIS model "${pin.buffer.name}" does not support driving on ${port}.`,
        )
      }
      if (signal.driver_disabled && !capabilities.disable) {
        throw new Error(
          `${label}: ${port} model ${pin.buffer.name} has no disabled state; use pattern="0" or "1".`,
        )
      }
      driven.set(port, signal)
      edgeTimesSeconds.push(edgeDurationSeconds(pin))
      for (const net of sourceNetMembers({
        connectivity: signalConnectivity,
        memberId: port,
      })) {
        const owner = topology.get(net)
        if (owner && owner !== signal.name) {
          throw new Error(
            `Signals "${owner}" and "${signal.name}" are on the same net; one signal per net.`,
          )
        }
        topology.set(net, signal.name)
      }
    }
    for (const receiver of signal.receivers) {
      if ("source_port_id" in receiver !== "source_port_id" in signal.driver) {
        throw new Error(
          `${signal.name}: driver and receiver must use the same endpoint shape`,
        )
      }
      for (const [index, port] of endpointPorts(receiver).entries()) {
        const pin = pins.get(port)
        if (!pin)
          throw new Error(
            `${label} receiver ${port} has no <simulation.ibismodel>.`,
          )
        if (!pinCapabilities(pin).receive) {
          throw new Error(
            `${label}: selected IBIS model "${pin.buffer.name}" does not support receiving on ${port}.`,
          )
        }
        const driverNet = sourceNetMembers({
          connectivity: signalConnectivity,
          memberId: drivers[index],
        })
        if (!driverNet.has(port)) {
          throw new Error(
            `Receiver ${port} is not connected to the copper of signal "${signal.name}".`,
          )
        }
      }
    }
    if ("p_source_port_id" in signal.driver)
      checkDifferentialPairs({ signal, pins })
  }
  return { driven, topology, edgeTimesSeconds }
}

/** Check that each differential pair belongs to one chip and follows the model's pin order. */
function checkDifferentialPairs({
  signal,
  pins,
}: {
  signal: SimulationPcbDriverReceiverChannel
  pins: Map<SourcePortId, InspectedPin>
}): void {
  const label = `Signal "${signal.name}"`
  for (const endpoint of [signal.driver, ...signal.receivers]) {
    const [p, n] = endpointPorts(endpoint).map((port) => pins.get(port)!)
    const pair = p.component.differentialPins.find(
      (pair) => pair.pin === p.pin && pair.invertedPin === n.pin,
    )
    if (p.model.source_component_id !== n.model.source_component_id) {
      throw new Error(
        `${label}: both differential legs must belong to the same chip.`,
      )
    }
    if (!pair) {
      const mismatch = `${label}: differential pin order disagrees with IBIS [Diff_pin];`
      throw new Error(`${mismatch} swap p and n or repair the model mapping.`)
    }
    // The vendor's model Polarity is already applied by the converter.
  }
}

/** Pruned circuit and inspected pins pointing to its updated model records. */
type PrunedIbisModels = Pick<PreparedChannelSimulation, "circuit" | "pins">

/** Keep only IBIS models and mapped ports needed by the retained pins. */
function withUsedIbisModels({
  circuit,
  pins,
}: {
  circuit: CircuitJson
  pins: Map<SourcePortId, InspectedPin>
}): PrunedIbisModels {
  const models = new Map<InspectedPin["model"], InspectedPin["model"]>()
  for (const model of cju([...circuit]).simulation_ibis_model.list()) {
    const used = [...pins.values()].filter((pin) => pin.model === model)
    if (!used.length) continue
    const ports = new Set(
      used.flatMap((pin) => [pin.port, ...Object.values(pin.references)]),
    )
    const mappings = Object.entries(model.ibis_pin_name_to_source_port_id)
    models.set(model, {
      ...model,
      ibis_pin_name_to_source_port_id: Object.fromEntries(
        mappings.filter(([, port]) => ports.has(port)),
      ),
      ibis_pin_name_to_reference_source_port_ids: Object.fromEntries(
        used.map(({ pin, references }) => [
          pin,
          {
            pullup_reference_source_port_id: references.pullup,
            pulldown_reference_source_port_id: references.pulldown,
            power_clamp_reference_source_port_id: references.powerClamp,
            ground_clamp_reference_source_port_id: references.groundClamp,
            external_reference_source_port_id: references.external,
          },
        ]),
      ),
    })
  }
  return {
    circuit: circuit.flatMap((record): CircuitJson => {
      if (record.type !== "simulation_ibis_model") return [record]
      const model = models.get(record)
      if (model === undefined) return []
      return [model]
    }),
    pins: new Map(
      Array.from(pins, ([id, pin]) => [
        id,
        { ...pin, model: models.get(pin.model)! },
      ]),
    ),
  }
}

/** Find nodes that exist independently of the passive loads. */
function loadNodes({
  circuit,
  copperScope,
  pins,
}: {
  circuit: CircuitJson
  copperScope: CopperScope
  pins: PreparedChannelSimulation["pins"]
}): LoadNodeIds {
  const scoped = new Set(copperScope.extractedPcbTraceIds)
  const railTraces = new Set(copperScope.nearbyRailPcbTraceIds)
  const db = cju([...circuit])
  const routed = new Set(
    db.pcb_trace
      .list()
      .filter(
        (trace) =>
          scoped.has(trace.pcb_trace_id) && !railTraces.has(trace.pcb_trace_id),
      )
      .map((trace) => trace.source_trace_id),
  )
  const traces = db.source_trace.list()
  const ideal = getSourcePortConnectivityMapFromCircuitJson(
    traces.filter((trace) => !routed.has(trace.source_trace_id)),
  )
  const routeTerminals = traces
    .filter((trace) => routed.has(trace.source_trace_id))
    .flatMap((trace) => [
      ...trace.connected_source_port_ids,
      ...(trace.connected_source_net_ids ?? []),
    ])
  const bufferTerminals = [...pins.values()].flatMap((pin) => [
    pin.port,
    ...Object.values(pin.references),
  ])
  const sourceTerminals = db.simulation_voltage_source
    .list()
    .flatMap(voltageSourceTerminals)
  const nodes: LoadNodeIds = new Set()
  for (const terminal of [
    ...routeTerminals,
    ...bufferTerminals,
    ...sourceTerminals,
  ]) {
    if (terminal === undefined) continue
    for (const id of sourceNetMembers({
      connectivity: ideal,
      memberId: terminal,
    }))
      nodes.add(id)
  }
  return nodes
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

/** Independent channel simulation: model overrides, copper, pin states, references and stimuli. */
function prepareChannelSimulation({
  boardCircuitJson,
  channelSimulation,
  sources,
  distanceMm,
}: {
  boardCircuitJson: CircuitJson
  channelSimulation: SimulationPcbTransientChannelSimulation
  sources: IbisSources
  distanceMm: number
}): PreparedChannelSimulation {
  const simulationPcbTransientChannelSimulationId = safeId({
    raw: channelSimulation.simulation_pcb_transient_channel_simulation_id,
    field: "simulationPcbTransientChannelSimulationId",
  })
  const channels = cju([
    ...boardCircuitJson,
  ]).simulation_pcb_driver_receiver_channel.list()
  const driverReceiverChannels = channels.filter(
    (channel) =>
      channel.simulation_pcb_transient_channel_simulation_id ===
      simulationPcbTransientChannelSimulationId,
  )
  driverReceiverChannels.sort((a, b) => compareNames({ a: a.name, b: b.name }))
  const signalNames = new Set(
    driverReceiverChannels.map((signal) => signal.name),
  )
  const simulationPcbDriverReceiverChannelIds = new Set(
    driverReceiverChannels.map(
      (signal) => signal.simulation_pcb_driver_receiver_channel_id,
    ),
  )
  if (
    !driverReceiverChannels.length ||
    signalNames.size !== driverReceiverChannels.length ||
    simulationPcbDriverReceiverChannelIds.size !== driverReceiverChannels.length
  ) {
    throw new Error(
      `${channelSimulation.name ?? simulationPcbTransientChannelSimulationId}: require distinct named signals`,
    )
  }
  const durationSeconds = channelSimulationDurationSeconds({
    channelSimulation,
    driverReceiverChannels,
  })
  // Keep the physical board and part models, and drop every other simulation record.
  const boardRecordsWithoutSimulations = boardCircuitJson.filter(
    (record) =>
      !record.type.startsWith("simulation_") ||
      PART_MODEL_RECORD_TYPES.includes(record.type),
  )
  const channelSimulationCircuitJson = withIbisModelOverrides({
    circuit: [
      ...boardRecordsWithoutSimulations,
      channelSimulation,
      ...driverReceiverChannels,
    ],
    driverReceiverChannels,
  })
  const endpointIds = new Set(
    driverReceiverChannels.flatMap((signal) =>
      [signal.driver, ...signal.receivers].flatMap(endpointPorts),
    ),
  )
  const selectedPins = inspectPins({
    circuit: channelSimulationCircuitJson,
    sources,
    ports: endpointIds,
  })
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(
    channelSimulationCircuitJson,
  )
  const rails = collectRailIds({
    circuit: channelSimulationCircuitJson,
    connectivity,
    pins: selectedPins,
  })
  const routedTopology = signalTopology({
    circuit: channelSimulationCircuitJson,
    rails,
  })
  const { driven, topology, edgeTimesSeconds } = indexDriverReceiverChannels({
    driverReceiverChannels,
    pins: selectedPins,
    signalConnectivity: routedTopology.connectivity,
  })
  const reference = selectedPins.get([...driven.keys()].sort()[0])!.references
    .pulldown
  const copperScope = channelCopperScope({
    circuit: channelSimulationCircuitJson,
    connectivity,
    channelSourceIds: new Set(topology.keys()),
    referenceSourceIds: sourceNetMembers({ connectivity, memberId: reference }),
    railSourceIds: rails,
    distanceMm,
  })
  const retained = new Set(copperScope.extractedSourceIds)
  const ports = new Set([...retained].filter((port) => !rails.has(port)))
  for (const port of endpointIds) ports.add(port)
  const inspectedPins = inspectPins({
    circuit: channelSimulationCircuitJson,
    sources,
    ports,
  })
  for (const [port, name] of topology) {
    const pin = inspectedPins.get(port)
    if (!pin || driven.has(port) || pin.buffer.type !== "output") continue
    const drivers = `Signal "${name}" has two drivers: the listed driver and ${port} (IBIS model "${pin.buffer.name}").`
    throw new Error(`${drivers} Exactly one pin drives a signal.`)
  }
  validateSignalGraph({
    circuit: channelSimulationCircuitJson,
    topology: routedTopology,
    driverReceiverChannels,
    allowUnroutedTraces: channelSimulation.allow_unrouted_traces,
  })
  const edgeTimeSeconds = Math.min(...edgeTimesSeconds)
  const rate = Math.max(
    ...driverReceiverChannels.map((signal) => signal.bit_rate_bps),
  )
  const stepSeconds = Math.min(
    1 / rate / STEPS_PER_BIT,
    edgeTimeSeconds / STEPS_PER_EDGE,
    durationSeconds / MIN_STEPS_PER_RECORDING,
  )
  const db = cju([...channelSimulationCircuitJson])
  const circuitPorts = db.source_port.list()
  const components = db.source_component.list()
  for (const port of circuitPorts) {
    if (
      !topology.has(port.source_port_id) ||
      inspectedPins.has(port.source_port_id)
    )
      continue
    const component = components.find(
      (component) => component.source_component_id === port.source_component_id,
    )
    if (
      hasSupportedComponentModel({
        component,
        circuit: channelSimulationCircuitJson,
      })
    )
      continue
    const label = component?.name ?? port.source_port_id
    throw new Error(
      `${label} is on the signal and has no supported SPICE or IBIS model.`,
    )
  }
  const { lanes, rejections } = routedLanes({
    circuit: channelSimulationCircuitJson,
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
  // Stable physical endpoint identities order the matrix; route coordinates set coupling.
  lanes.sort((a, b) => a.from.sourcePortId!.localeCompare(b.from.sourcePortId!))
  const { circuit: prunedCircuit, pins } = withUsedIbisModels({
    circuit: channelSimulationCircuitJson,
    pins: inspectedPins,
  })
  const stack = stackupFromCircuitJson(prunedCircuit)
  if (!stack.relativePermittivity) {
    throw new Error(
      "<simulation.pcbtransientchannelsimulation> needs explicit stackup dielectric constants.",
    )
  }
  const settings: NumericalSettings = {
    lanes,
    copperScope,
    channelReference: { sourcePortId: reference },
  }
  if (copperScope.extractedPcbViaIds.length && !stack.viaPlatingMm) {
    throw new Error(
      "pcb_stackup must specify plated_hole_copper_thickness for routed vias",
    )
  }
  const { circuit: suppliedCircuit, supplies } = withChannelSimulationSupplies({
    circuit: prunedCircuit,
    connectivity,
    pins,
    retained,
    reference,
  })
  if (supplies.length) settings.supplies = supplies
  const nodes = loadNodes({ circuit: suppliedCircuit, copperScope, pins })
  const spiceModels = db.simulation_spice_subcircuit.list()
  // Keep a retained load only when every modeled terminal already has an external connection.
  settings.passiveComponents = components.flatMap((component) => {
    if (!hasSupportedComponentModel({ component, circuit: suppliedCircuit }))
      return []
    const sourceComponentId = component.source_component_id
    const model = spiceModels.find(
      (record) => record.source_component_id === sourceComponentId,
    )
    let terminals = circuitPorts
      .filter((port) => port.source_component_id === sourceComponentId)
      .map((port) => port.source_port_id)
    if (model) terminals = Object.values(model.spice_pin_to_source_port_map)
    if (!terminals.some((port) => retained.has(port) && !rails.has(port)))
      return []
    if (!terminals.every((port) => nodes.has(port))) return []
    return [{ sourceComponentId }]
  })
  const { circuit, controls } = withChannelSimulationControls({
    circuit: suppliedCircuit,
    simulationPcbTransientChannelSimulationId,
    channelSimulation,
    driverReceiverChannels,
    pins,
    driven,
    durationSeconds,
    rate,
    stepSeconds,
  })
  return {
    channelSimulation,
    driverReceiverChannels,
    circuit,
    controls: { [simulationPcbTransientChannelSimulationId]: controls },
    pins,
    settings,
    durationSeconds,
  }
}
