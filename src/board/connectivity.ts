import type { SourceComponentBase } from 'circuit-json'
import type { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import type { SourceNetId, SourcePortId } from './ids'
import type { CircuitJson } from './schema'

/** The identifier of a source component in Circuit JSON. */
type SourceComponentId = SourceComponentBase['source_component_id']

export { getSourcePortConnectivityMapFromCircuitJson, type ConnectivityMap } from 'circuit-json-to-connectivity-map'

/** Resolve the seed's electrical net, including an isolated seed. */
export function sourceNetMembers({ connectivity, seed }: {
  connectivity: ConnectivityMap
  seed: SourcePortId | SourceNetId
}): SourceNetMembers {
  const netId = connectivity.getNetConnectedToId(seed)
  if (netId === undefined) return new Set([seed])
  return new Set([seed, ...connectivity.getIdsConnectedToNet(netId)])
}

/** Ids the board wires together through a trace or a part's internally connected pins. */
export type SourceConnectionGroup = Array<SourcePortId | SourceNetId>

/** Source port and net identifiers on one electrical net. */
export type SourceNetMembers = Set<SourcePortId | SourceNetId>

/** Collect source connectivity groups in the same order as the library's source map. */
export function sourceConnections(circuit: CircuitJson): SourceConnectionGroup[] {
  return circuit.flatMap(record => {
    if (record.type === 'source_trace') {
      return [[...record.connected_source_port_ids ?? [], ...record.connected_source_net_ids ?? []]]
    }
    if (record.type === 'source_component') return record.internally_connected_source_port_ids ?? []
    if (record.type === 'source_component_internal_connection') return [record.source_port_ids]
    return []
  })
}

/** The two pins of a resistor, capacitor or inductor treated as wired together for a signal. */
export type PassiveBridge = [pinA: SourcePortId, pinB: SourcePortId]

/** Find two-terminal resistors, capacitors and inductors with neither pin excluded. */
export function passiveBridges({ circuit, excluded }: {
  circuit: CircuitJson
  excluded: ReadonlySet<SourcePortId>
}): PassiveBridge[] {
  const ports = new Map<SourceComponentId, SourcePortId[]>()
  for (const port of circuit) {
    if (port.type !== 'source_port' || port.source_component_id === undefined) continue
    const pins = ports.get(port.source_component_id)
    if (!pins) {
      ports.set(port.source_component_id, [port.source_port_id])
      continue
    }
    pins.push(port.source_port_id)
  }
  const passiveTypes = ['simple_resistor', 'simple_capacitor', 'simple_inductor']
  const connections: PassiveBridge[] = []
  for (const component of circuit) {
    if (component.type !== 'source_component') continue
    if (!passiveTypes.includes(component.ftype)) continue
    const pins = ports.get(component.source_component_id)
    if (pins?.length === 2 && pins.every(pin => !excluded.has(pin))) connections.push(pins as PassiveBridge)
  }
  return connections
}
