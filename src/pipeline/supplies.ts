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

interface ReferenceBias {
  port: SourcePortId
  voltage: number
}

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
    for (const port of Object.values(pin.references)) {
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
  const { connectivity, pins, reference, settings } = options
  const sources = retainedVoltageSources(circuit, options)
  const sourceNets = new Set([...sources.values()].flat())
  for (const source of circuit.filter(
    (record) => record.type === "simulation_voltage_source",
  )) {
    if (!sources.has(source)) circuit.splice(circuit.indexOf(source), 1)
  }
  const ground = netKey(connectivity, reference)
  const netVoltages = new Map<string, ReferenceBias>()
  const externalPorts = new Set<SourcePortId>()
  for (const pin of pins.values()) {
    const voltages = referenceVoltages(pin.buffer)
    const ports = pin.references
    if (ports.external) externalPorts.add(ports.external)
    const roles = Object.keys(voltages) as Array<keyof typeof voltages>
    for (const role of roles) {
      const voltage = voltages[role]
      const port = ports[role]
      if (!Number.isFinite(voltage))
        throw new Error(
          `${pin.port}: invalid typical ${role} reference voltage.`,
        )
      const key = netKey(connectivity, port)
      const previous = netVoltages.get(key)
      if (
        previous &&
        Math.abs(previous.voltage - voltage) > REFERENCE_VOLTAGE_TOLERANCE_V
      ) {
        throw new Error(
          `${pin.port}: shared reference has incompatible IBIS typical voltages.`,
        )
      }
      if (!previous) netVoltages.set(key, { port, voltage })
    }
  }
  for (const port of externalPorts) {
    const key = netKey(connectivity, port)
    if (key === ground || netVoltages.has(key) || sourceNets.has(key)) continue
    throw new Error(
      `${port}: external IBIS reference has no declared or nominal bias.`,
    )
  }
  for (const [key, { port, voltage }] of netVoltages) {
    if (key === ground) {
      if (Math.abs(voltage) > REFERENCE_VOLTAGE_TOLERANCE_V) {
        throw new Error(
          `${port}: nonzero IBIS reference shares the channel ground.`,
        )
      }
      continue
    }
    if (sourceNets.has(key)) continue
    settings.supplies ??= []
    settings.supplies.push({
      positive: { sourcePortId: port },
      negative: { sourcePortId: reference },
      voltageV: voltage,
    })
  }
}
