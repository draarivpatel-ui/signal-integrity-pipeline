import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("requires enough panels per edge", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  assert.throws(
    () => solveCrossSection({ section, options: { panelsPerEdge: 1 } }),
    { code: "cross_section_options" },
  )
})
