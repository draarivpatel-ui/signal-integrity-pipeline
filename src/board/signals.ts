import type {
  SignalEndpoint,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
} from "circuit-json"

export type {
  SignalEndpoint,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
}

/** Check whether a valid channel pattern repeats a single bit. */
function isConstantBitPattern(pattern: string): boolean {
  const first = pattern[0]
  for (const bit of pattern) {
    if (bit !== first) return false
  }
  return true
}

/** Pattern and timing shared by selected channels and aggressors. */
export type DriverPattern = Pick<
  SimulationPcbDriverReceiverChannel,
  "name" | "pattern" | "bit_rate_bps" | "offset_ms" | "seed" | "driver_disabled"
>

/** Returns whether a channel has a disabled driver or a constant literal bit pattern. */
export function isQuiet(channel: DriverPattern): boolean {
  return (
    channel.driver_disabled === true || isConstantBitPattern(channel.pattern)
  )
}
