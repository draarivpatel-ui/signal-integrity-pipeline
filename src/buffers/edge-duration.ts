import { fail } from "./diagnostics"
import { type InspectedPin, pinCapabilities } from "./inspect"

/** Time and typical voltage at one point on an IBIS waveform. */
type WaveformSample = readonly [timeSeconds: number, voltage: number]

/** First interpolated crossing of a measured edge voltage, in seconds. */
function edgeCrossingSeconds({
  samples,
  target,
}: {
  samples: readonly WaveformSample[]
  target: number
}): number | undefined {
  for (let i = 1; i < samples.length; i++) {
    const [startSeconds, startVoltage] = samples[i - 1]
    const [endSeconds, endVoltage] = samples[i]
    const low = Math.min(startVoltage, endVoltage)
    const high = Math.max(startVoltage, endVoltage)
    if (target < low || target > high) continue

    const voltageChange = endVoltage - startVoltage
    const elapsedSeconds = endSeconds - startSeconds
    const crossingSeconds =
      startSeconds + ((target - startVoltage) * elapsedSeconds) / voltageChange
    // A threshold can round to the voltage of a flat interval.
    if (!Number.isNaN(crossingSeconds)) return crossingSeconds
  }
  return undefined
}

/** Start the edge duration measurement at 10% of the voltage swing. */
const EDGE_START_FRACTION = 0.1

/** End the edge duration measurement at 90% of the voltage swing. */
const EDGE_END_FRACTION = 0.9

/** Scale the 20–80% ramp duration to 10–90% for a linear transition. */
const RAMP_TO_EDGE_DURATION = 4 / 3

/** Fastest typical 10–90% output edge duration from a waveform or [Ramp]. */
export function edgeDurationSeconds(pin: InspectedPin): number {
  if (!pinCapabilities(pin).drive)
    fail(
      "ibis_edge_not_driving",
      `${pin.port}: input-only pin has no IBIS output edge duration`,
    )

  const durationsSeconds: number[] = []
  for (const waveform of pin.buffer.waveforms) {
    const samples: WaveformSample[] = []
    for (const [timeSeconds, typicalVoltage] of waveform.data) {
      if (typicalVoltage === null) continue
      samples.push([timeSeconds, typicalVoltage])
    }
    const first = samples[0]
    const last = samples.at(-1)
    if (!first || !last) continue
    const firstVoltage = first[1]
    const swing = last[1] - firstVoltage

    const startSeconds = edgeCrossingSeconds({
      samples,
      target: firstVoltage + swing * EDGE_START_FRACTION,
    })
    const endSeconds = edgeCrossingSeconds({
      samples,
      target: firstVoltage + swing * EDGE_END_FRACTION,
    })
    if (startSeconds === undefined || endSeconds === undefined) continue
    const durationSeconds = endSeconds - startSeconds
    if (durationSeconds > 0) durationsSeconds.push(durationSeconds)
  }
  if (durationsSeconds.length) return Math.min(...durationsSeconds)

  // Use the typical ramp ratios when no waveform is usable.
  const ramp = pin.buffer.ramp
  const ratios = [ramp?.rising[0], ramp?.falling[0]]
  for (const ratio of ratios) {
    if (!ratio || ratio.voltage <= 0 || ratio.timeSeconds <= 0) continue
    const durationSeconds = ratio.timeSeconds * RAMP_TO_EDGE_DURATION
    durationsSeconds.push(durationSeconds)
  }
  if (!durationsSeconds.length)
    fail(
      "ibis_edge_duration_missing",
      `${pin.port}: IBIS edge duration missing at the typical corner`,
    )
  return Math.min(...durationsSeconds)
}
