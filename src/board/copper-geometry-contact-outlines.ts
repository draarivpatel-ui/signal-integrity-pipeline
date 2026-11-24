import type { Polygon } from "@flatten-js/core"
import {
  circlePolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import type { Snapshot } from "../kernel"
import { CONTACT_TOLERANCE_MM } from "./copper-geometry-pad-contact"
import type { WireChord } from "./copper-geometry-simplify"
import type { TraceWire } from "./copper-geometry-types"
import type { UnionedWire } from "./copper-geometry-union"
import type { CopperScope } from "./geometry/scope"

/** Actual copper contributing to a modeled wire interval. */
export interface WireOutline {
  wire: TraceWire
  physicalWire: TraceWire
  outline: Polygon
  startCap?: Polygon
  endCap?: Polygon
}

/** Clamp an interpolation fraction to the original wire. */
function clampFraction(fraction: number): number {
  return Math.max(0, Math.min(1, fraction))
}

/** Clip a physical wire to the modeled longitudinal interval. */
function getWireOutline({
  wire,
  physicalWire,
}: {
  wire: TraceWire
  physicalWire: TraceWire
}): WireOutline | undefined {
  const [axisX, axisY] = wire.direction
  const [startX, startY] = physicalWire.startPoint
  const [endX, endY] = physicalWire.endPoint
  const dx = endX - startX
  const dy = endY - startY
  const startMm = startX * axisX + startY * axisY
  const endMm = endX * axisX + endY * axisY
  if (
    Math.max(startMm, endMm) < wire.longitudinalMinMm - CONTACT_TOLERANCE_MM ||
    Math.min(startMm, endMm) > wire.longitudinalMaxMm + CONTACT_TOLERANCE_MM
  )
    return undefined

  const intervalStartMm =
    wire.startPoint[0] * axisX + wire.startPoint[1] * axisY
  const intervalEndMm = wire.endPoint[0] * axisX + wire.endPoint[1] * axisY
  let startFraction = 0
  let endFraction = 1
  if (startMm !== endMm) {
    startFraction = clampFraction(
      (intervalStartMm - startMm) / (endMm - startMm),
    )
    endFraction = clampFraction((intervalEndMm - startMm) / (endMm - startMm))
  }
  const start = {
    x: startX + dx * startFraction,
    y: startY + dy * startFraction,
  }
  const end = { x: startX + dx * endFraction, y: startY + dy * endFraction }
  const outline: WireOutline = {
    wire,
    physicalWire,
    outline: getTraceSegmentPolygon(start, end, physicalWire.widthMm),
  }
  const radiusMm = physicalWire.widthMm / 2
  if (
    Math.abs(start.x * axisX + start.y * axisY - intervalStartMm) <=
    CONTACT_TOLERANCE_MM
  )
    outline.startCap = circlePolygon(start, radiusMm)
  if (
    Math.abs(end.x * axisX + end.y * axisY - intervalEndMm) <=
    CONTACT_TOLERANCE_MM
  )
    outline.endCap = circlePolygon(end, radiusMm)
  return outline
}

/** Associate physical copper with every modeled interval it contributes to. */
export function getWireOutlines({
  mergedWires,
  chords,
  copperScope,
}: {
  mergedWires: UnionedWire[]
  chords: WireChord[]
  copperScope: Snapshot<CopperScope>
}): WireOutline[] {
  const outlines: WireOutline[] = []
  for (const { wire, contributingWires } of mergedWires) {
    for (const chord of contributingWires) {
      if (copperScope.nearbyRailPcbTraceIds.includes(chord.pcbTraceId)) continue
      for (const physicalWire of chords[chord.wireIndex].physicalWires) {
        const outline = getWireOutline({ wire, physicalWire })
        if (outline) outlines.push(outline)
      }
    }
  }
  return outlines
}
