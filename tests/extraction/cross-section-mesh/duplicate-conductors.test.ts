import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects duplicate conductor IDs", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  const duplicates = [section.conductors[0], section.conductors[0]]
  assert.throws(
    () =>
      solveCrossSection({ section: { ...section, conductors: duplicates } }),
    { code: "cross_section_geometry" },
  )
})
