import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects overlapping slabs", () => {
  const crossSection = sectionFixture({ kind: "mask", count: 2 })
  const overlappingSlabs = [
    ...crossSection.dielectricLayers,
    crossSection.dielectricLayers[0],
  ]
  assert.throws(
    () =>
      calculateRlgc({
        crossSection: { ...crossSection, dielectricLayers: overlappingSlabs },
      }),
    { code: "cross_section_geometry" },
  )
})
