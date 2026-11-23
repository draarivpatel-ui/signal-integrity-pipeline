import { type Datum, sampleAt } from "../chart"
import { crossings } from "./waveforms"

export interface EyeFold {
  segments: Datum[][]
  height?: number
  widthFraction?: number
  crossingVoltage: number
  violations: number
  mask: Datum[]
}

interface EyeOptions {
  points: Datum[]
  bitNs: number
  startNs: number
  skip: number
  phase: number
  crossingVoltage: number
  maskHeight: number
  maskWidth: number
}

/** Test a linear trace segment against a centered diamond using four half-plane clips. */
function hitsMask({
  first,
  second,
  center,
  halfWidth,
  halfHeight,
}: {
  first: Datum
  second: Datum
  center: Datum
  halfWidth: number
  halfHeight: number
}): boolean {
  if (!(halfWidth > 0) || !(halfHeight > 0)) return false
  let enter = 0
  let exit = 1
  for (const horizontal of [-1, 1])
    for (const vertical of [-1, 1]) {
      const a =
        (horizontal * (first[0] - center[0])) / halfWidth +
        (vertical * (first[1] - center[1])) / halfHeight
      const b =
        (horizontal * (second[0] - center[0])) / halfWidth +
        (vertical * (second[1] - center[1])) / halfHeight
      if (a > 1 && b > 1) return false
      if (a > 1 === b > 1) continue
      const at = (1 - a) / (b - a)
      if (a > 1) enter = Math.max(enter, at)
      else exit = Math.min(exit, at)
      if (enter > exit) return false
    }
  return true
}

/** Fold consecutive, fully measured two-bit windows and derive aperture and mask evidence. */
export function foldEye({
  points,
  bitNs,
  startNs,
  skip,
  phase,
  crossingVoltage,
  maskHeight,
  maskWidth,
}: EyeOptions): EyeFold {
  const segments: Datum[][] = []
  const center: Datum = [1.5, crossingVoltage]
  const halfWidth = maskWidth / 2
  const halfHeight = maskHeight / 2
  const mask: Datum[] = [
    [center[0] - halfWidth, center[1]],
    [center[0], center[1] + halfHeight],
    [center[0] + halfWidth, center[1]],
    [center[0], center[1] - halfHeight],
  ]
  const result: EyeFold = { segments, crossingVoltage, violations: 0, mask }
  if (!(bitNs > 0) || points.length < 2) return result
  const phaseStart = startNs + bitNs * phase
  let sample = 0
  let low = -Infinity
  let high = Infinity
  const last = points.at(-1)![0]
  for (
    let start = phaseStart + Math.max(0, Math.floor(skip)) * bitNs;
    start + 2 * bitNs <= last + bitNs * 1e-8;
    start += bitNs
  ) {
    const end = Math.min(last, start + 2 * bitNs)
    const first = sampleAt({ points, x: start })
    const final = sampleAt({ points, x: end })
    if (first === undefined || final === undefined) continue
    while (sample < points.length && points[sample][0] <= start) sample++
    const line: Datum[] = [[0, first]]
    for (let i = sample; i < points.length && points[i][0] < end; i++)
      line.push([(points[i][0] - start) / bitNs, points[i][1]])
    line.push([2, final])
    segments.push(line)
    for (const position of [0.5, 1.5]) {
      const reading = sampleAt({ points: line, x: position })!
      if (reading < crossingVoltage) low = Math.max(low, reading)
      else high = Math.min(high, reading)
    }
    if (
      line.some(
        (second, index) =>
          index > 0 &&
          hitsMask({
            first: line[index - 1],
            second,
            center,
            halfWidth,
            halfHeight,
          }),
      )
    )
      result.violations++
  }
  if (Number.isFinite(low) && Number.isFinite(high)) result.height = high - low
  if (result.height === undefined) return result
  let earliest = Infinity
  let latest = -Infinity
  for (const { x } of crossings({ points, threshold: crossingVoltage })) {
    if (x < phaseStart + skip * bitNs) continue
    const cycles = (x - phaseStart) / bitNs
    const displacement = cycles - Math.round(cycles)
    earliest = Math.min(earliest, displacement)
    latest = Math.max(latest, displacement)
  }
  if (Number.isFinite(earliest))
    result.widthFraction = Math.max(0, 1 - (latest - earliest))
  return result
}
