import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  isQuiet,
  type SignalEndpoint,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
  stackupFromCircuitJson,
} from "../board"
import {
  edgeSeconds,
  type IbisSources,
  type InspectedPin,
  inspectPins,
  pinCapabilities,
  referenceVoltages,
} from "../buffers"
import { safeId } from "../kernel"
import type { RunControls } from "../simulation"
import type { NumericalSettings } from "./modeling"
import { defaultDurationSeconds } from "./timing"
import { signalTopology, validateSignalGraph } from "./topology"

type SourceNetKey = string

export interface PreparedBlock {
  duration: number
  block: SimulationPcbTransientChannelSimulation
  signals: SimulationPcbDriverReceiverChannel[]
  circuit: CircuitJson
  controls: Record<string, RunControls>
  pins: Map<SourcePortId, InspectedPin>
  settings: NumericalSettings
  warnings: string[]
}
/** Ordered physical ports: the sign of a differential signal is P minus N. */
export function endpointPorts(endpoint: SignalEndpoint): SourcePortId[] {
  if ("source_port_id" in endpoint) return [endpoint.source_port_id]
  return [endpoint.p_source_port_id, endpoint.n_source_port_id]
}

const prbsPatterns = new Map([
  ["prbs7", { width: 7, tap: 6 }],
  ["prbs15", { width: 15, tap: 14 }],
  ["prbs31", { width: 31, tap: 28 }],
])

/** Check for a nonempty string of literal binary digits. */
function isBitPattern(pattern: string): boolean {
  if (pattern.length === 0) return false
  for (const bit of pattern) {
    if (bit !== "0" && bit !== "1") return false
  }
  return true
}

/** Seeded PRBS generation bounded by the actual requested recording; never allocate a full PRBS31 period. */
export function signalBits(
  signal: SimulationPcbDriverReceiverChannel,
  duration: number,
): string {
  const prbs = prbsPatterns.get(signal.pattern)
  const mask = prbs ? 2 ** prbs.width - 1 : 0
  if (
    prbs &&
    (!Number.isInteger(signal.seed) || signal.seed! < 1 || signal.seed! > mask)
  )
    throw new Error(
      `Signal "${signal.name}": ${signal.pattern} seed must be an integer in 1..${mask}.`,
    )
  if (signal.driver_disabled) return "0"
  if (signal.pattern === "clock") return "01"
  if (!prbs) {
    if (!isBitPattern(signal.pattern))
      throw new Error(
        `${signal.name}: pattern must be PRBS, clock, or a literal bit string`,
      )
    return signal.pattern
  }
  let state = signal.seed!
  const count = Math.min(
    mask,
    Math.ceil(
      Math.max(0, duration - signal.offset_ms / 1000) * signal.bit_rate_bps,
    ) + 1,
  )
  const { width, tap } = prbs
  let bits = ""
  for (let i = 0; i < count; i++) {
    bits += String((state >>> (width - 1)) & 1)
    state =
      ((state << 1) | (((state >>> (width - 1)) ^ (state >>> (tap - 1))) & 1)) &
      mask
  }
  return bits
}
/** Supported lanes and rejection messages from auditing the scoped copper. */
type RoutedLanes = { lanes: NumericalSettings["lanes"]; rejections: string[] }

/** Audit only selected/nearby routed nets; unsupported neighbours remain visible. */
export function routedLanes({
  circuit,
  scope,
  topology,
  driven,
  rails,
}: {
  circuit: CircuitJson
  scope: CopperScope
  topology: Map<SourcePortId | SourceNetId, string>
  driven: Set<SourcePortId>
  rails: Set<SourcePortId | SourceNetId>
}): RoutedLanes {
  const lanes: NumericalSettings["lanes"] = []
  const rejections: string[] = []
  for (const trace of circuit
    .filter((r) => r.type === "source_trace")
    .sort((a, b) => a.source_trace_id.localeCompare(b.source_trace_id))) {
    const ports = trace.connected_source_port_ids
    const pcb = circuit
      .filter((r) => r.type === "pcb_trace")
      .filter((r) => r.source_trace_id === trace.source_trace_id)
    if (
      !pcb.some((route) => scope.pcbTraceIds.includes(route.pcb_trace_id)) ||
      [...ports, ...(trace.connected_source_net_ids ?? [])].some((port) =>
        rails.has(port),
      )
    )
      continue
    if (ports.length !== 2 || pcb.length !== 1) {
      rejections.push(
        `Signal "${topology.get(ports[0]) ?? trace.name ?? trace.display_name ?? trace.source_trace_id}": branched routed graphs are not implemented yet.`,
      )
      continue
    }
    const ordered = [...ports].sort()
    if (driven.has(ordered[1]) && !driven.has(ordered[0])) ordered.reverse()
    lanes.push({
      port: `${topology.get(ordered[0]) || "passive"}_${trace.source_trace_id}`,
      from: { sourcePortId: ordered[0] },
      to: { sourcePortId: ordered[1] },
      sourceTraceId: trace.source_trace_id,
    })
  }
  return { lanes, rejections }
}
/** Validate the shared block namespace before any independent block work. */
export function signalBlocks(
  circuitJson: CircuitJson,
): SimulationPcbTransientChannelSimulation[] {
  const blocks = circuitJson.filter(
    (r) => r.type === "simulation_pcb_transient_channel_simulation",
  )
  if (blocks.length > 1 && blocks.some((block) => !block.name))
    throw new Error(
      `This board has ${blocks.length} <simulation.pcbtransientchannelsimulation> blocks; give each a name.`,
    )
  const ids = new Set(
    blocks.map((b) => b.simulation_pcb_transient_channel_simulation_id),
  )
  if (ids.size !== blocks.length)
    throw new Error(
      "Duplicate simulation_pcb_transient_channel_simulation identifier",
    )
  for (const signal of circuitJson.filter(
    (r) => r.type === "simulation_pcb_driver_receiver_channel",
  ))
    if (!ids.has(signal.simulation_pcb_transient_channel_simulation_id))
      throw new Error(`${signal.name}: unknown signal-integrity block`)
  return blocks
}
/** Validate one block and lower its test intent to the private routed declarations. */
export function prepareBlockById({
  circuit,
  sources,
  blockId,
  distanceMm = 32,
}: {
  circuit: CircuitJson
  sources: IbisSources
  blockId: string
  distanceMm?: number
}): PreparedBlock {
  if (!Number.isFinite(distanceMm) || distanceMm <= 0 || distanceMm > 32)
    throw new Error("Copper scope distance must be in (0,32] mm")
  const matches = signalBlocks(circuit).filter(
    (block) => block.simulation_pcb_transient_channel_simulation_id === blockId,
  )
  if (matches.length !== 1)
    throw new Error(`Expected exactly one signal-integrity block ${blockId}`)
  const warnings: string[] = []
  try {
    return prepareBlock({
      input: circuit,
      block: matches[0],
      sources,
      warnings,
      distanceMm,
    })
  } catch (error) {
    throw Object.assign(error as Error, { warnings })
  }
}
/** Selected IBIS model for a single-ended pin or one ordered differential leg. */
function selectedIbisModel(
  endpoint: SignalEndpoint,
  index: number,
): string | undefined {
  if ("source_port_id" in endpoint) return endpoint.ibis_model_name
  if (index === 0) return endpoint.p_ibis_model_name
  return endpoint.n_ibis_model_name
}

/** Include a quiet driver as the last probe after the receivers. */
export function probeEndpoints(
  signal: SimulationPcbDriverReceiverChannel,
): SignalEndpoint[] {
  if (isQuiet(signal)) return [...signal.receivers, signal.driver]
  return signal.receivers
}

/** Use the explicit block duration when present, in seconds. */
function blockDurationSeconds(
  block: SimulationPcbTransientChannelSimulation,
  signals: SimulationPcbDriverReceiverChannel[],
): number {
  if (block.duration_ms !== undefined) return block.duration_ms / 1000
  return defaultDurationSeconds(signals)
}

/** Unicode code point order, independent of locale and UTF-16 surrogate ordering. */
export function compareNames(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0)!)
  const right = Array.from(b, (c) => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i] - right[i]
  return left.length - right.length
}

/** Independent block: model overrides, copper, pin states, references and stimuli. */
function prepareBlock({
  input,
  block,
  sources,
  warnings,
  distanceMm,
}: {
  input: CircuitJson
  block: SimulationPcbTransientChannelSimulation
  sources: IbisSources
  warnings: string[]
  distanceMm: number
}): PreparedBlock {
  const id = safeId(
    block.simulation_pcb_transient_channel_simulation_id,
    "simulationPcbTransientChannelSimulationId",
  )
  const signals = input
    .filter((r) => r.type === "simulation_pcb_driver_receiver_channel")
    .filter((r) => r.simulation_pcb_transient_channel_simulation_id === id)
    .sort((a, b) => compareNames(a.name, b.name))
  if (
    !signals.length ||
    new Set(signals.map((s) => s.name)).size !== signals.length ||
    new Set(signals.map((s) => s.simulation_pcb_driver_receiver_channel_id))
      .size !== signals.length
  )
    throw new Error(`${block.name ?? id}: require distinct named signals`)
  const duration = blockDurationSeconds(block, signals)
  const circuit = structuredClone([
    ...input.filter(
      (r) =>
        !r.type.startsWith("simulation_") ||
        [
          "simulation_ibis_model",
          "simulation_voltage_source",
          "simulation_spice_subcircuit",
        ].includes(r.type),
    ),
    block,
    ...signals,
  ])
  for (const model of circuit.filter(
    (r) => r.type === "simulation_ibis_model",
  )) {
    for (const signal of signals)
      for (const endpoint of [signal.driver, ...signal.receivers]) {
        for (const [index, port] of endpointPorts(endpoint).entries()) {
          const selected = selectedIbisModel(endpoint, index)
          if (!selected) continue
          for (const [pin, target] of Object.entries(
            model.ibis_pin_name_to_source_port_id,
          )) {
            if (target !== port) continue
            model.ibis_pin_name_to_model_name = {
              ...model.ibis_pin_name_to_model_name,
              [pin]: selected,
            }
          }
        }
      }
  }
  const pins = inspectPins(circuit, sources)

  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const rails = new Set<SourcePortId | SourceNetId>()
  for (const port of [...pins.values()]
    .flatMap((pin) => [pin.ground, pin.power])
    .concat(
      circuit
        .filter((record) => record.type === "source_net")
        .filter((net) => net.is_ground || net.is_power)
        .map((net) => net.source_net_id),
    )) {
    if (rails.has(port)) continue
    for (const connected of sourceNetMembers(connectivity, port))
      rails.add(connected)
  }
  for (const pin of pins.values()) {
    const model = pin.model
    model.ibis_pin_name_to_reference_source_port_ids ??= {}
    model.ibis_pin_name_to_reference_source_port_ids[pin.pin] ??= {
      pullup_reference_source_port_id: pin.power,
      power_clamp_reference_source_port_id: pin.power,
      pulldown_reference_source_port_id: pin.ground,
      ground_clamp_reference_source_port_id: pin.ground,
    }
  }
  const signalConnectivity = signalTopology({ circuit, rails })
  const driven = new Map<SourcePortId, SimulationPcbDriverReceiverChannel>()
  const topology = new Map<SourcePortId | SourceNetId, string>()
  const edges: number[] = []
  for (const signal of signals) {
    safeId(
      signal.simulation_pcb_driver_receiver_channel_id,
      "simulationPcbDriverReceiverChannelId",
    )
    const drivers = endpointPorts(signal.driver)
    for (const port of drivers) {
      const pin = pins.get(port)
      if (!pin)
        throw new Error(
          `Signal "${signal.name}" driver ${port} has no <simulation.ibismodel>.`,
        )
      const capabilities = pinCapabilities(pin)
      if (!capabilities.drive)
        throw new Error(
          `Signal "${signal.name}": selected IBIS model "${pin.buffer.name}" does not support driving on ${port}.`,
        )
      if (signal.driver_disabled && !capabilities.disable)
        throw new Error(
          `Signal "${signal.name}": ${port} model ${pin.buffer.name} has no disabled state; use pattern="0" or "1".`,
        )
      driven.set(port, signal)
      edges.push(edgeSeconds(pin))
      for (const net of sourceNetMembers(signalConnectivity, port)) {
        const owner = topology.get(net)
        if (owner && owner !== signal.name)
          throw new Error(
            `Signals "${owner}" and "${signal.name}" are on the same net; one signal per net.`,
          )
        topology.set(net, signal.name)
      }
    }
    for (const receiver of signal.receivers) {
      if ("source_port_id" in receiver !== "source_port_id" in signal.driver)
        throw new Error(
          `${signal.name}: driver and receiver must use the same endpoint shape`,
        )
      for (const [index, port] of endpointPorts(receiver).entries()) {
        const pin = pins.get(port)
        if (!pin)
          throw new Error(
            `Signal "${signal.name}" receiver ${port} has no <simulation.ibismodel>.`,
          )
        if (!pinCapabilities(pin).receive)
          throw new Error(
            `Signal "${signal.name}": selected IBIS model "${pin.buffer.name}" does not support receiving on ${port}.`,
          )
        if (!sourceNetMembers(signalConnectivity, drivers[index]).has(port))
          throw new Error(
            `Receiver ${port} is not connected to the copper of signal "${signal.name}".`,
          )
      }
    }
    if (!("p_source_port_id" in signal.driver)) continue
    for (const endpoint of [signal.driver, ...signal.receivers]) {
      const [p, n] = endpointPorts(endpoint).map((port) => pins.get(port)!)
      const pair = p.component.differentialPins.find(
        (pair) => pair.pin === p.pin && pair.invertedPin === n.pin,
      )
      if (p.model.source_component_id !== n.model.source_component_id)
        throw new Error(
          `Signal "${signal.name}": both differential legs must belong to the same chip.`,
        )
      if (!pair)
        throw new Error(
          `Signal "${signal.name}": differential pin order disagrees with IBIS [Diff_pin]; swap p and n or repair the model mapping.`,
        )
      // The vendor's model Polarity is already applied by the converter.
    }
  }
  for (const [port, name] of topology) {
    const pin = pins.get(port)
    if (pin && !driven.has(port) && pin.buffer.type === "output")
      throw new Error(
        `Signal "${name}" has two drivers: the listed driver and ${port} (IBIS model "${pin.buffer.name}"). Exactly one pin drives a signal.`,
      )
  }
  validateSignalGraph({
    circuit,
    connectivity,
    signalConnectivity,
    signals,
    rails,
    allowUnroutedTraces: block.allow_unrouted_traces,
  })
  const edge = Math.min(...edges)
  const rate = Math.max(...signals.map((s) => s.bit_rate_bps))
  const step = Math.min(1 / rate / 100, edge / 20)
  const reference = pins.get([...driven.keys()].sort()[0])!.ground
  const copperScope = channelCopperScope({
    circuit,
    connectivity,
    selected: new Set(topology.keys()),
    reference: sourceNetMembers(connectivity, reference),
    rails,
    distanceMm,
  })
  for (const port of circuit
    .filter((r) => r.type === "source_port")
    .filter(
      (port) =>
        topology.has(port.source_port_id) && !pins.has(port.source_port_id),
    )) {
    const component = circuit
      .filter((r) => r.type === "source_component")
      .find(
        (component) =>
          component.source_component_id === port.source_component_id,
      )
    if (
      !component ||
      (!["simple_resistor", "simple_capacitor", "simple_inductor"].includes(
        component.ftype,
      ) &&
        !circuit.some(
          (r) =>
            r.type === "simulation_spice_subcircuit" &&
            r.source_component_id === component.source_component_id,
        ))
    )
      throw new Error(
        `${component?.name ?? port.source_port_id} is on the signal and has no supported SPICE or IBIS model.`,
      )
  }
  const scopeForLanes = {
    ...copperScope,
    pcbTraceIds: copperScope.selectedPcbTraceIds,
  }
  const { lanes, rejections } = routedLanes({
    circuit,
    scope: scopeForLanes,
    topology,
    driven: new Set(driven.keys()),
    rails,
  })
  if (rejections.length)
    throw Object.assign(new Error(rejections[0]), { rejections, copperScope })
  if (!block.allow_unrouted_traces) {
    for (const signal of signals)
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
    if (!lanes.length)
      throw new Error(
        "At least one routed conductor is required for routed extraction",
      )
  }
  // Stable physical endpoint identities order the matrix; route coordinates set coupling.
  lanes.sort((a, b) => a.from.sourcePortId!.localeCompare(b.from.sourcePortId!))
  const retained = new Set(topology.keys())
  for (const trace of circuit.filter(
    (record) => record.type === "source_trace",
  )) {
    if (
      !circuit.some(
        (record) =>
          record.type === "pcb_trace" &&
          record.source_trace_id === trace.source_trace_id &&
          copperScope.pcbTraceIds.includes(record.pcb_trace_id),
      )
    )
      continue
    for (const port of trace.connected_source_port_ids)
      for (const id of sourceNetMembers(connectivity, port)) retained.add(id)
  }
  const laneMembers = new Set(
    lanes.flatMap((lane) =>
      [lane.from.sourcePortId!, lane.to.sourcePortId!].flatMap((port) => [
        ...sourceNetMembers(connectivity, port),
      ]),
    ),
  )
  for (const id of laneMembers) retained.add(id)
  for (const [port] of pins) if (!retained.has(port)) pins.delete(port)
  for (const model of circuit.filter(
    (r) => r.type === "simulation_ibis_model",
  )) {
    const used = [...pins.values()].filter((pin) => pin.model === model)
    const ports = new Set(
      used.flatMap((pin) => [
        pin.port,
        pin.power,
        pin.ground,
        ...Object.values(
          model.ibis_pin_name_to_reference_source_port_ids?.[pin.pin] ?? {},
        ),
      ]),
    )
    model.ibis_pin_name_to_source_port_id = Object.fromEntries(
      Object.entries(model.ibis_pin_name_to_source_port_id).filter(([, port]) =>
        ports.has(port),
      ),
    )
    if (!used.length) circuit.splice(circuit.indexOf(model), 1)
  }
  const stack = stackupFromCircuitJson(circuit)
  if (!stack.relativePermittivity)
    throw new Error(
      "<simulation.pcbtransientchannelsimulation> needs explicit stackup dielectric constants.",
    )
  const settings: NumericalSettings = {
    lanes,
    copperScope,
    channelReference: { sourcePortId: reference },
    passiveComponents: circuit
      .filter((r) => r.type === "source_component")
      .filter(
        (r) =>
          (["simple_resistor", "simple_capacitor", "simple_inductor"].includes(
            r.ftype,
          ) ||
            circuit.some(
              (model) =>
                model.type === "simulation_spice_subcircuit" &&
                model.source_component_id === r.source_component_id,
            )) &&
          circuit.some(
            (port) =>
              port.type === "source_port" &&
              port.source_component_id === r.source_component_id &&
              !rails.has(port.source_port_id) &&
              laneMembers.has(port.source_port_id),
          ),
      )
      .map((r) => ({ sourceComponentId: r.source_component_id })),
  }
  if (copperScope.pcbViaIds.length && !stack.viaPlatingMm)
    throw new Error(
      "pcb_stackup must specify plated_hole_copper_thickness for routed vias",
    )
  const netVoltages = new Map<SourceNetKey, number>()
  for (const pin of pins.values()) {
    const voltages = referenceVoltages(pin.buffer)
    const refs = pin.model.ibis_pin_name_to_reference_source_port_ids![pin.pin]
    const ports = {
      pullup: refs.pullup_reference_source_port_id ?? pin.power,
      pulldown: refs.pulldown_reference_source_port_id ?? pin.ground,
      powerClamp: refs.power_clamp_reference_source_port_id ?? pin.power,
      groundClamp: refs.ground_clamp_reference_source_port_id ?? pin.ground,
    }
    const net = [...sourceNetMembers(connectivity, pin.power)].sort().join(",")
    const supplied = netVoltages.has(net)
    for (const [role, voltage] of Object.entries(voltages)) {
      const key = [
        ...sourceNetMembers(connectivity, ports[role as keyof typeof ports]),
      ]
        .sort()
        .join(",")
      if (
        netVoltages.has(key) &&
        Math.abs(netVoltages.get(key)! - voltage) > 1e-8
      )
        throw new Error(
          `${pin.port}: shared reference has incompatible IBIS typical voltages.`,
        )
      netVoltages.set(key, voltage)
    }
    if (supplied) continue
    settings.supplies ??= []
    settings.supplies.push({
      positive: { sourcePortId: pin.power },
      negative: { sourcePortId: pin.ground },
      voltageV: voltages.pullup,
    })
  }
  for (let i = circuit.length - 1; i >= 0; i--)
    if (circuit[i].type === "simulation_voltage_source") circuit.splice(i, 1)
  const controls: RunControls = { states: [], stimuli: [] }
  const scope = circuit.find((r) => r.type === "pcb_board")?.subcircuit_id
  circuit.push({
    type: "simulation_experiment",
    simulation_experiment_id: id,
    name: block.name ?? id,
    experiment_type: "spice_transient_analysis",
    spice_engine: "pcb_spice",
    spice_options: { reltol: 1e-5, abstol: 1e-12, vntol: 1e-8 },
    end_time_ms: duration * 1000,
    start_time_ms: 0,
    time_per_step: step * 1000,
    subcircuit_id: scope,
  })
  for (const pin of pins.values()) {
    const signal = driven.get(pin.port)
    const capabilities = pinCapabilities(pin)
    const output = signal !== undefined || !capabilities.receive
    let enabled =
      capabilities.drive && !capabilities.disable && !capabilities.receive
    if (signal) enabled = !signal.driver_disabled
    const state: RunControls["states"][number] = {
      source_port_id: pin.port,
      is_output: output,
    }
    if (output) state.is_output_enabled = enabled
    controls.states.push(state)
    if (!signal && enabled)
      controls.stimuli.push({
        name: pin.port,
        source_port_id: pin.port,
        bit_duration_ms: 1000 / rate,
        start_time_ms: 0,
        initial_state: 0,
        inverted: pin.buffer.polarity === "inverting",
        transmission_pattern: {
          transmission_type: "bits",
          bits: "0",
          repeat: true,
        },
      })
  }
  for (const signal of signals) {
    const bits = signalBits(signal, duration)
    if (signal.driver_disabled) continue
    let initialState: 0 | 1 = 0
    if (bits[0] === "1") initialState = 1
    for (const [index, port] of endpointPorts(signal.driver).entries()) {
      const pin = pins.get(port)!
      const inversion = Boolean(index) !== (pin.buffer.polarity === "inverting")
      controls.stimuli.push({
        name: signal.name,
        source_port_id: port,
        bit_duration_ms: 1000 / signal.bit_rate_bps,
        start_time_ms: signal.offset_ms,
        initial_state: initialState,
        inverted: inversion,
        transmission_pattern: { transmission_type: "bits", bits, repeat: true },
      })
    }
  }
  for (const signal of signals)
    for (const [index, endpoint] of probeEndpoints(signal).entries()) {
      const ports = endpointPorts(endpoint)
      let ref = ports[1]
      if (!("p_source_port_id" in endpoint)) ref = pins.get(ports[0])!.ground
      circuit.push({
        type: "simulation_voltage_probe",
        simulation_voltage_probe_id: `${signal.simulation_pcb_driver_receiver_channel_id}_${index}`,
        name: `${signal.name}_${index}`,
        signal_input_source_port_id: ports[0],
        reference_input_source_port_id: ref,
        subcircuit_id: scope,
      })
    }
  return {
    block,
    signals,
    circuit,
    controls: { [id]: controls },
    pins,
    settings,
    warnings,
    duration,
  }
}
