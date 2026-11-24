import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("requires a reference plane", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  assert.throws(
    () => solveCrossSection({ section: { ...section, planes: [] } }),
    { code: "cross_section_geometry" },
  )
})
