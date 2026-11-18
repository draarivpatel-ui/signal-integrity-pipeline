import type { SimulationVoltageSource } from "circuit-json"
import type {
  CircuitJson,
  ConnectivityMap,
  SourceNetId,
  SourcePortId,
} from "../board"
import { type InspectedPin, referenceVoltages } from "../buffers"
import { type SimulationModeling, voltageSourceTerminals } from "../simulation"

/** Allowed difference between typical IBIS voltages on one reference net. */
const REFERENCE_VOLTAGE_TOLERANCE_V = 1e-8

interface BlockSupplyOptions {
  connectivity: ConnectivityMap
  pins: Map<SourcePortId, InspectedPin>
  retained: ReadonlySet<SourcePortId | SourceNetId>
  reference: SourcePortId
  settings: SimulationModeling
}

/** Canonical connectivity-map net, or the original port/net for an isolated endpoint. */
function netKey(
  connectivity: ConnectivityMap,
  id: SourcePortId | SourceNetId,
): string {
  return connectivity.getNetConnectedToId(id) ?? id
}

/** Include sources reachable from the retained nets without traversing the shared reference. */
function retainedVoltageSources(
  circuit: CircuitJson,
  { connectivity, pins, retained, reference }: BlockSupplyOptions,
): Map<SimulationVoltageSource, string[]> {
  const candidates = circuit
    .filter((record) => record.type === "simulation_voltage_source")
    .map((source) => {
      const terminals = voltageSourceTerminals(source)
      return {
        source,
        nets: terminals.flatMap((id) =>
          id === undefined ? [] : [netKey(connectivity, id)],
        ),
      }
    })
  const nets = new Set([...retained].map((id) => netKey(connectivity, id)))
  for (const pin of pins.values()) {
    const references =
      pin.model.ibis_pin_name_to_reference_source_port_ids?.[pin.pin] ?? {}
    for (const port of [pin.power, pin.ground, ...Object.values(references)]) {
      if (port !== undefined) nets.add(netKey(connectivity, port))
    }
  }
  const ground = netKey(connectivity, reference)
  nets.delete(ground)
  const sources = new Map<SimulationVoltageSource, string[]>()
  for (const net of nets) {
    for (const candidate of candidates) {
      if (!candidate.nets.includes(net) || sources.has(candidate.source))
        continue
      sources.set(candidate.source, candidate.nets)
      for (const adjacent of candidate.nets) {
        if (adjacent !== ground) nets.add(adjacent)
      }
    }
  }
  return sources
}

/** Retain declared sources and infer a nominal supply only for an unpowered IBIS rail. */
export function addBlockSupplies(
  circuit: CircuitJson,
  options: BlockSupplyOptions,
): void {
  const { connectivity, pins, settings } = options
  const sources = retainedVoltageSources(circuit, options)
  const sourceNets = new Set([...sources.values()].flat())
  for (const source of circuit.filter(
    (record) => record.type === "simulation_voltage_source",
  )) {
    if (!sources.has(source)) circuit.splice(circuit.indexOf(source), 1)
  }
  const netVoltages = new Map<string, number>()
  for (const pin of pins.values()) {
    const voltages = referenceVoltages(pin.buffer)
    const refs = pin.model.ibis_pin_name_to_reference_source_port_ids![pin.pin]
    const ports = {
      pullup: refs.pullup_reference_source_port_id ?? pin.power,
      pulldown: refs.pulldown_reference_source_port_id ?? pin.ground,
      powerClamp: refs.power_clamp_reference_source_port_id ?? pin.power,
      groundClamp: refs.ground_clamp_reference_source_port_id ?? pin.ground,
    }
    const net = netKey(connectivity, pin.power)
    const supplied = sourceNets.has(net) || netVoltages.has(net)
    for (const [role, voltage] of Object.entries(voltages)) {
      const key = netKey(connectivity, ports[role as keyof typeof ports])
      const previous = netVoltages.get(key)
      if (
        previous !== undefined &&
        Math.abs(previous - voltage) > REFERENCE_VOLTAGE_TOLERANCE_V
      ) {
        throw new Error(
          `${pin.port}: shared reference has incompatible IBIS typical voltages.`,
        )
      }
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
}
