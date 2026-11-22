import { z } from "zod"
import {
  type CircuitJsonDb,
  type CircuitJsonSnapshot,
  circuitJsonDb,
  type DriverPattern,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
} from "../board"
import { type InspectedPin, pinCapabilities } from "../buffers"
import { prbsPatterns } from "./timing"

// The pinned Circuit JSON schema predates these fields: https://github.com/tscircuit/circuit-json/pull/1042
const nearbyDriverDeclaration = z.object({
  nearby_driver_pattern: z.string().min(1).optional(),
  nearby_drivers_disabled: z.boolean().optional(),
})

/** An enabled pattern or a disabled output for each drive-capable pin outside the selected endpoints. */
export type NearbyDrivers = Map<SourcePortId, DriverPattern | null>

/** Identify the pin in diagnostics by the circuit's component and port names. */
function nearbyDriverName({
  db,
  pin,
}: {
  db: CircuitJsonDb
  pin: InspectedPin
}): string {
  const component = db.source_component.get(pin.model.source_component_id)
  const port = db.source_port.get(pin.port)
  return `${component?.name ?? "unnamed component"}.${port?.name ?? pin.pin}`
}

/** Resolve the declared drive or disable state of every nearby driver in source-port order. */
export function planNearbyDrivers({
  circuit,
  channelSimulation,
  pins,
  endpointIds,
}: {
  circuit: CircuitJsonSnapshot
  channelSimulation: SimulationPcbTransientChannelSimulation
  pins: Map<SourcePortId, InspectedPin>
  endpointIds: ReadonlySet<SourcePortId>
}): NearbyDrivers {
  const drivers: NearbyDrivers = new Map()
  const nearbyPins = [...pins.values()]
    .filter((pin) => !endpointIds.has(pin.port) && pinCapabilities(pin).drive)
    .sort((a, b) => a.port.localeCompare(b.port, "en"))
  if (nearbyPins.length === 0) return drivers

  const { nearby_driver_pattern: pattern, nearby_drivers_disabled: disabled } =
    nearbyDriverDeclaration.parse(channelSimulation)
  const db = circuitJsonDb(circuit)
  if (disabled) {
    for (const pin of nearbyPins) {
      if (!pinCapabilities(pin).disable) {
        const name = nearbyDriverName({ db, pin })
        throw new Error(
          `${name}: IBIS model "${pin.buffer.name}" has no disabled state. Set nearbyDriverPattern to drive these pins.`,
        )
      }
      drivers.set(pin.port, null)
    }
    return drivers
  }
  if (pattern === undefined) {
    const names = nearbyPins.map((pin) => nearbyDriverName({ db, pin }))
    throw new Error(
      `Nearby drivers ${names.join(", ")} need a declared state. Set nearbyDriverPattern or nearbyDriversDisabled.`,
    )
  }
  const prbs = prbsPatterns.get(pattern)
  for (const [index, pin] of nearbyPins.entries()) {
    const signal: DriverPattern = {
      name: nearbyDriverName({ db, pin }),
      pattern,
      bit_rate_bps: channelSimulation.bit_rate_bps,
      offset_ms: 0,
    }
    if (prbs) {
      const seedCount = 2 ** prbs.width - 1
      signal.seed = 1 + Math.floor((index * seedCount) / nearbyPins.length)
    }
    drivers.set(pin.port, signal)
  }
  return drivers
}
