import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects overlapping slabs", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  const overlappingSlabs = [...section.dielectrics, section.dielectrics[0]]
  assert.throws(
    () =>
      solveCrossSection({
        section: { ...section, dielectrics: overlappingSlabs },
      }),
    { code: "cross_section_geometry" },
  )
})
