import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects a flat conductor", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  const flat = [{ ...section.conductors[0], thicknessMm: 0 }]
  assert.throws(
    () => solveCrossSection({ section: { ...section, conductors: flat } }),
    { code: "cross_section_geometry" },
  )
})
