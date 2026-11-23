import type { SourceComponentBase } from "circuit-json"
import {
  type ConnectivityMap,
  getSourcePortConnectivityMapFromCircuitJson as getSourcePortConnectivity,
} from "circuit-json-to-connectivity-map"
import { type CircuitJsonDb, circuitJsonDb } from "./circuit-json-db"
import type { SourceNetId, SourcePortId } from "./ids"
import type { CircuitJson, CircuitJsonSnapshot } from "./schema"

/** The identifier of a source component in Circuit JSON. */
type SourceComponentId = SourceComponentBase["source_component_id"]

export type { ConnectivityMap } from "circuit-json-to-connectivity-map"

/** Read source connectivity from a borrowed Circuit JSON record array. */
export function getSourcePortConnectivityMapFromCircuitJson(
  circuit: CircuitJsonSnapshot,
): ConnectivityMap {
  return getSourcePortConnectivity(circuit as CircuitJson)
}

/** Return the electrical net members, including the given ID even when isolated. */
export function sourceNetMembers({
  connectivity,
  memberId,
}: {
  connectivity: ConnectivityMap
  memberId: SourcePortId | SourceNetId
}): SourceNetMembers {
  const netId = connectivity.getNetConnectedToId(memberId)
  if (netId === undefined) return new Set([memberId])
  return new Set([memberId, ...connectivity.getIdsConnectedToNet(netId)])
}

/** Ids the board wires together through a trace or a part's internally connected pins. */
export type SourceConnectionGroup = Array<SourcePortId | SourceNetId>

/** Source port and net identifiers on one electrical net. */
export type SourceNetMembers = Set<SourcePortId | SourceNetId>

/** Read internal pin ties from both Circuit JSON representations. */
export function sourcePinTies(db: CircuitJsonDb): SourceConnectionGroup[] {
  return [
    ...db.source_component
      .list()
      .flatMap((component) =>
        (component.internally_connected_source_port_ids ?? []).map((ids) => [
          ...ids,
        ]),
      ),
    ...db.source_component_internal_connection
      .list()
      .map((connection) => [...connection.source_port_ids]),
  ]
}

/** Collect explicit source traces and component pin ties. */
export function sourceConnections(
  circuit: CircuitJsonSnapshot,
): SourceConnectionGroup[] {
  const db = circuitJsonDb(circuit)
  return [
    ...db.source_trace
      .list()
      .map((trace) => [
        ...trace.connected_source_port_ids,
        ...(trace.connected_source_net_ids ?? []),
      ]),
    ...sourcePinTies(db),
  ]
}

/** The two pins of a resistor, capacitor or inductor treated as wired together for a signal. */
export type PassiveBridge = [pinA: SourcePortId, pinB: SourcePortId]

/** Find two-terminal resistors, capacitors and inductors with neither pin excluded. */
export function passiveBridges({
  circuit,
  excluded,
}: {
  circuit: CircuitJsonSnapshot
  excluded: ReadonlySet<SourcePortId>
}): PassiveBridge[] {
  const db = circuitJsonDb(circuit)
  const ports = new Map<SourceComponentId, SourcePortId[]>()
  for (const port of db.source_port.list()) {
    if (port.source_component_id === undefined) continue
    const pins = ports.get(port.source_component_id)
    if (!pins) {
      ports.set(port.source_component_id, [port.source_port_id])
      continue
    }
    pins.push(port.source_port_id)
  }
  const passiveTypes = [
    "simple_resistor",
    "simple_capacitor",
    "simple_inductor",
  ]
  const connections: PassiveBridge[] = []
  for (const component of db.source_component.list()) {
    if (!passiveTypes.includes(component.ftype)) continue
    const pins = ports.get(component.source_component_id)
    if (pins?.length === 2 && pins.every((pin) => !excluded.has(pin)))
      connections.push(pins as PassiveBridge)
  }
  return connections
}

/** Check the same leg boundary for a physical or a source-level passive bridge. */
export function crossesDifferentialLegs<T>({
  from,
  to,
  differential,
}: {
  from: T
  to: T
  differential: readonly {
    positive: ReadonlySet<T>
    negative: ReadonlySet<T>
  }[]
}): boolean {
  return differential.some(
    ({ positive, negative }) =>
      (positive.has(from) && negative.has(to)) ||
      (positive.has(to) && negative.has(from)),
  )
}
