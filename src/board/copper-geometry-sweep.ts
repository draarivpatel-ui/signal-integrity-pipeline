import type { Snapshot } from "../kernel"
import type { LongitudinalInterval } from "./copper-geometry-reference-range"
import {
  findReferenceBoundariesMm,
  findWireReferences,
} from "./copper-geometry-references"
import type {
  ExtractedCopper,
  TraceWire,
  WireSection,
} from "./copper-geometry-types"
import {
  type DirectionKey,
  getDirectionKey,
  getWirePoint,
  groupWiresByGap,
  roundWireCoordinate,
} from "./copper-geometry-wire"
import type { CopperScope } from "./geometry/scope"

/** Ignore negligible intervals and treat adjacent boundaries within this tolerance as coincident. */
const SECTION_TOLERANCE_MM = 1e-6

type ReferenceProfileKey = string
type SectionKey = string
type SectionSweepGeometry = Pick<ExtractedCopper, "wires" | "pours" | "stackup">

/** Wires sharing the same physical reference profile along one interval. */
type SectionProfile = Pick<WireSection, "wires" | "references">

/** Collect active wires under each exact reference profile. */
function groupSectionReferences({
  geometry,
  wires,
  interval,
  copperScope,
}: {
  geometry: SectionSweepGeometry
  wires: TraceWire[]
  interval: LongitudinalInterval
  copperScope: Snapshot<CopperScope>
}): Iterable<SectionProfile> {
  const profiles = new Map<ReferenceProfileKey, SectionProfile>()
  const positionMm = (interval.startMm + interval.endMm) / 2
  for (const wire of wires) {
    if (
      wire.longitudinalMinMm > positionMm ||
      wire.longitudinalMaxMm < positionMm
    )
      continue
    const references = findWireReferences({
      geometry,
      wire,
      positionMm,
      interval,
    })
    if (!references.length) {
      if (copperScope.nearbyRailPcbTraceIds.includes(wire.pcbTraceId)) continue
      const point = getWirePoint({ wire, positionMm })
      throw new Error(
        `${wire.pcbTraceId} ${wire.layer} at ${point}: no actual reference pour`,
      )
    }
    const key = JSON.stringify(references)
    const profile = profiles.get(key)
    if (profile) profile.wires.push(wire)
    else profiles.set(key, { wires: [wire], references })
  }
  return profiles.values()
}

/** Partition one parallel direction at changes in nearby copper and references. */
function sweepDirection({
  geometry,
  wires,
  copperScope,
}: {
  geometry: SectionSweepGeometry
  wires: TraceWire[]
  copperScope: Snapshot<CopperScope>
}): WireSection[] {
  const positionsMm = wires.flatMap((wire) => [
    wire.longitudinalMinMm,
    wire.longitudinalMaxMm,
    ...findReferenceBoundariesMm({ wire, geometry }),
  ])
  const boundariesMm = [...new Set(positionsMm.map(roundWireCoordinate))].sort(
    (a, b) => a - b,
  )
  const sections: WireSection[] = []
  for (let index = 1; index < boundariesMm.length; index++) {
    const startMm = boundariesMm[index - 1]
    const endMm = boundariesMm[index]
    if (endMm - startMm < SECTION_TOLERANCE_MM) continue
    for (const profile of groupSectionReferences({
      geometry,
      wires,
      interval: { startMm, endMm },
      copperScope,
    })) {
      const groups = groupWiresByGap({
        wires: profile.wires,
        gapMm: copperScope.nearbyGapMm,
      })
      for (const group of groups) {
        if (
          group.every((wire) =>
            copperScope.nearbyRailPcbTraceIds.includes(wire.pcbTraceId),
          )
        )
          continue
        sections.push({
          startMm,
          endMm,
          wires: group,
          references: profile.references,
        })
      }
    }
  }
  return sections
}

/** Join consecutive intervals whose wires and references are unchanged. */
function mergeSections(sections: WireSection[]): WireSection[] {
  const merged: WireSection[] = []
  const previousIndices = new Map<SectionKey, number>()
  for (const section of sections) {
    const key = JSON.stringify([
      section.wires.map((wire) => wire.wireIndex),
      section.references,
    ])
    const index = previousIndices.get(key)
    if (
      index !== undefined &&
      Math.abs(merged[index].endMm - section.startMm) < SECTION_TOLERANCE_MM
    ) {
      merged[index] = { ...merged[index], endMm: section.endMm }
      continue
    }
    previousIndices.set(key, merged.length)
    merged.push(section)
  }
  return merged
}

/** Section parallel signal and rail wires by their longitudinal and lateral geometry. */
export function sweepWireSections({
  geometry,
  copperScope,
}: {
  geometry: SectionSweepGeometry
  copperScope: Snapshot<CopperScope>
}): WireSection[] {
  const directions = new Map<DirectionKey, TraceWire[]>()
  for (const wire of geometry.wires) {
    const directionKey = getDirectionKey(wire.direction)
    const group = directions.get(directionKey)
    if (group) group.push(wire)
    else directions.set(directionKey, [wire])
  }
  const sections = [...directions.values()].flatMap((wires) =>
    sweepDirection({ geometry, wires, copperScope }),
  )
  return mergeSections(sections)
}
