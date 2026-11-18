import type { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import type { CircuitJson } from './schema'

type SourceComponentId = string

export { getSourcePortConnectivityMapFromCircuitJson, type ConnectivityMap } from 'circuit-json-to-connectivity-map'

/** Resolve the seed's electrical net, including an isolated seed. */
export function sourceNetMembers(connectivity: ConnectivityMap, seed: string): Set<string> {
  const netId = connectivity.getNetConnectedToId(seed)
  if (netId === undefined) return new Set([seed])
  return new Set([seed, ...connectivity.getIdsConnectedToNet(netId)])
}

/** Collect source connectivity groups in the same order as the library's source map. */
export function sourceConnections(circuit: CircuitJson): string[][] {
  return circuit.flatMap(record => {
    if (record.type === 'source_trace') {
      return [[...record.connected_source_port_ids ?? [], ...record.connected_source_net_ids ?? []]]
    }
    if (record.type === 'source_component') return record.internally_connected_source_port_ids ?? []
    if (record.type === 'source_component_internal_connection') return [record.source_port_ids]
    return []
  })
}

/** Find two-terminal resistors, capacitors and inductors with neither pin excluded. */
export function passiveConnections(circuit: CircuitJson, excluded: ReadonlySet<string>): string[][] {
  const ports = new Map<SourceComponentId, string[]>()
  for (const port of circuit) {
    if (port.type !== 'source_port' || port.source_component_id === undefined) continue
    const pins = ports.get(port.source_component_id)
    if (pins) pins.push(port.source_port_id)
    else ports.set(port.source_component_id, [port.source_port_id])
  }
  const connections: string[][] = []
  for (const component of circuit) {
    if (component.type !== 'source_component' || !['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(component.ftype)) continue
    const pins = ports.get(component.source_component_id)
    if (pins?.length === 2 && pins.every(pin => !excluded.has(pin))) connections.push(pins)
  }
  return connections
}
