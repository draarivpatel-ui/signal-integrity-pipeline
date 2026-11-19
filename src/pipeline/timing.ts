import { isQuiet, type SimulationPcbDriverReceiverChannel } from "../board"

/** Unit intervals each switching channel needs to settle after it starts. */
const STARTUP_UNIT_INTERVALS = 16
/** Unit intervals the capture reserves for the eye after startup. */
const EYE_UNIT_INTERVALS = 128
/** Unit intervals needed to record the steady response in a quiet-only block. */
const QUIET_UNIT_INTERVALS = 32
/** Milliseconds in one second. */
export const MILLISECONDS_PER_SECOND = 1000

/**
 * Returns the default capture duration in seconds for a nonempty channel block.
 * Quiet-only blocks use the slowest channel rate. Constant drivers hold their
 * level from t=0, so their offsets are ignored.
 */
export function defaultDurationSeconds(
  channels: SimulationPcbDriverReceiverChannel[],
): number {
  const switching = channels.filter((channel) => !isQuiet(channel))
  if (switching.length === 0) {
    const unitIntervalSeconds = Math.max(
      ...channels.map((channel) => 1 / channel.bit_rate_bps),
    )
    return QUIET_UNIT_INTERVALS * unitIntervalSeconds
  }
  const unitIntervalSeconds = Math.max(
    ...switching.map((channel) => 1 / channel.bit_rate_bps),
  )
  const settleTimesSeconds = switching.map((channel) => {
    const startSeconds = channel.offset_ms / MILLISECONDS_PER_SECOND
    const settleSeconds = STARTUP_UNIT_INTERVALS / channel.bit_rate_bps
    return startSeconds + settleSeconds
  })
  const startupSeconds = Math.max(...settleTimesSeconds)
  return startupSeconds + EYE_UNIT_INTERVALS * unitIntervalSeconds
}
