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

/** Split physical copper at union boundaries while keeping overhang at the chord ends. */
function getWireOutline({
  wire,
  physicalWire,
  chord,
}: {
  wire: TraceWire
  chord: TraceWire
  physicalWire: TraceWire
}): WireOutline | undefined {
  const [axisX, axisY] = wire.direction
  const [startX, startY] = physicalWire.startPoint
  const [endX, endY] = physicalWire.endPoint
  const dx = endX - startX
  const dy = endY - startY
  const startMm = startX * axisX + startY * axisY
  const endMm = endX * axisX + endY * axisY
  const physicalMinMm = Math.min(startMm, endMm)
  const physicalMaxMm = Math.max(startMm, endMm)
  const { longitudinalMinMm, longitudinalMaxMm } = wire
  let contactMinMm = longitudinalMinMm
  let contactMaxMm = longitudinalMaxMm
  if (longitudinalMinMm <= chord.longitudinalMinMm + CONTACT_TOLERANCE_MM)
    contactMinMm = Math.min(contactMinMm, physicalMinMm)
  if (longitudinalMaxMm >= chord.longitudinalMaxMm - CONTACT_TOLERANCE_MM)
    contactMaxMm = Math.max(contactMaxMm, physicalMaxMm)
  if (
    physicalMaxMm < contactMinMm - CONTACT_TOLERANCE_MM ||
    physicalMinMm > contactMaxMm + CONTACT_TOLERANCE_MM
  )
    return undefined

  const isForward =
    wire.startPoint[0] * axisX + wire.startPoint[1] * axisY <
    wire.endPoint[0] * axisX + wire.endPoint[1] * axisY
  let intervalStartMm = longitudinalMinMm
  let intervalEndMm = longitudinalMaxMm
  let contactStartMm = contactMinMm
  let contactEndMm = contactMaxMm
  if (!isForward) {
    intervalStartMm = longitudinalMaxMm
    intervalEndMm = longitudinalMinMm
    contactStartMm = contactMaxMm
    contactEndMm = contactMinMm
  }
  let startFraction = 0
  let endFraction = 1
  if (startMm !== endMm) {
    startFraction = clampFraction(
      (contactStartMm - startMm) / (endMm - startMm),
    )
    endFraction = clampFraction((contactEndMm - startMm) / (endMm - startMm))
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
  const startProjectionMm = Math.min(
    longitudinalMaxMm,
    Math.max(longitudinalMinMm, start.x * axisX + start.y * axisY),
  )
  const endProjectionMm = Math.min(
    longitudinalMaxMm,
    Math.max(longitudinalMinMm, end.x * axisX + end.y * axisY),
  )
  if (Math.abs(startProjectionMm - intervalStartMm) <= CONTACT_TOLERANCE_MM)
    outline.startCap = circlePolygon(start, radiusMm)
  if (Math.abs(endProjectionMm - intervalEndMm) <= CONTACT_TOLERANCE_MM)
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
        const outline = getWireOutline({ wire, physicalWire, chord })
        if (outline) outlines.push(outline)
      }
    }
  }
  return outlines
}
