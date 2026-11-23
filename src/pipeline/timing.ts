import { type DriverPattern, isQuiet } from "../board"

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000
/** A quiet level needs one unit interval. */
const QUIET_PERIOD_BITS = 1
/** Clock alternates between one low bit and one high bit. */
const CLOCK_PERIOD_BITS = 2

/** Shift-register widths and feedback taps for each pseudo-random binary sequence (PRBS). */
export const prbsPatterns = new Map([
  ["prbs7", { width: 7, tap: 6 }],
  ["prbs15", { width: 15, tap: 14 }],
  ["prbs31", { width: 31, tap: 28 }],
])

/** End time in seconds after one pattern period, or one unit interval for a quiet driver. */
function channelEndSeconds(channel: DriverPattern): number {
  const { bit_rate_bps: rate, offset_ms, pattern } = channel
  if (isQuiet(channel)) return QUIET_PERIOD_BITS / rate

  const startSeconds = offset_ms / MILLISECONDS_PER_SECOND
  if (pattern === "clock") return startSeconds + CLOCK_PERIOD_BITS / rate

  const prbs = prbsPatterns.get(pattern)
  if (!prbs) return startSeconds + pattern.length / rate
  if (pattern !== "prbs7") {
    throw new Error(
      `${channel.name}: PRBS15 and PRBS31 need an explicit duration`,
    )
  }
  const periodBits = 2 ** prbs.width - 1
  return startSeconds + periodBits / rate
}

/** Returns the latest end time after one pattern per channel, with quiet levels starting at t=0. */
export function defaultDurationSeconds(
  channels: readonly DriverPattern[],
): number {
  return Math.max(...channels.map(channelEndSeconds))
}
