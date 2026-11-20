import type { IbisWaveform } from "@tscircuit/ibis-to-spice"
import { fail } from "./diagnostics"
import { type InspectedPin, pinCapabilities } from "./inspect"

/** Start the edge duration measurement at 10% of the voltage swing. */
const EDGE_START_FRACTION = 0.1

/** End the edge duration measurement at 90% of the voltage swing. */
const EDGE_END_FRACTION = 0.9

/** Scale the loaded [Ramp] time by the linear 10–90% to 20–80% span ratio (80% / 60%). */
const RAMP_TO_EDGE_DURATION = 4 / 3

/** Measure the first directed 10–90% excursion that stays at or beyond 10%. */
function waveformEdgeDurationSeconds({
  samples,
}: {
  samples: IbisWaveform["data"]
}): number | undefined {
  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last) return undefined
  const firstVoltage = first[1]
  const swing = last[1] - firstVoltage
  if (swing === 0) return undefined

  const direction = Math.sign(swing)
  const startThreshold =
    (firstVoltage + swing * EDGE_START_FRACTION) * direction
  const endThreshold = (firstVoltage + swing * EDGE_END_FRACTION) * direction
  let startSeconds: number | undefined
  for (let i = 1; i < samples.length; i++) {
    const [fromSeconds, fromSampleVoltage] = samples[i - 1]
    const [toSeconds, toSampleVoltage] = samples[i]
    const fromVoltage = fromSampleVoltage * direction
    const toVoltage = toSampleVoltage * direction
    if (toVoltage < startThreshold) {
      startSeconds = undefined
      continue
    }
    if (toVoltage <= fromVoltage) continue

    const voltageChange = toVoltage - fromVoltage
    const elapsedSeconds = toSeconds - fromSeconds
    if (startSeconds === undefined && fromVoltage <= startThreshold)
      startSeconds =
        fromSeconds +
        ((startThreshold - fromVoltage) / voltageChange) * elapsedSeconds
    if (startSeconds === undefined || toVoltage < endThreshold) continue

    const endSeconds =
      fromSeconds +
      ((endThreshold - fromVoltage) / voltageChange) * elapsedSeconds
    return endSeconds - startSeconds
  }
  return undefined
}

/**
 * Use the fastest 10–90% edge across all usable typical waveform tables to
 * bound the transient timestep, regardless of fixture load or edge direction.
 * Without a usable table, use the fastest typical [Ramp] estimate at R_load.
 */
export function edgeDurationSeconds(pin: InspectedPin): number {
  if (!pinCapabilities(pin).drive)
    fail(
      "ibis_edge_not_driving",
      `${pin.port}: input-only pin has no IBIS output edge duration`,
    )

  const durationsSeconds: number[] = []
  for (const waveform of pin.buffer.waveforms) {
    const durationSeconds = waveformEdgeDurationSeconds({
      samples: waveform.data,
    })
    if (durationSeconds !== undefined && durationSeconds > 0)
      durationsSeconds.push(durationSeconds)
  }
  if (durationsSeconds.length) return Math.min(...durationsSeconds)

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
