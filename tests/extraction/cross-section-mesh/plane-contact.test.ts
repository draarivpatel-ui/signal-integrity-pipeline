import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects a conductor touching a plane", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  const touchingPlane = [{ ...section.conductors[0], zMm: 0 }]
  assert.throws(
    () =>
      solveCrossSection({ section: { ...section, conductors: touchingPlane } }),
    { code: "cross_section_geometry" },
  )
})
