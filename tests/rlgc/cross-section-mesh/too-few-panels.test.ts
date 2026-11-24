import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { sectionFixture } from "../../fixtures/cross-section"

test("requires enough panels per edge", () => {
  const crossSection = sectionFixture({ kind: "mask", count: 2 })
  assert.throws(
    () => calculateRlgc({ crossSection, options: { panelsPerEdge: 1 } }),
    { code: "cross_section_options" },
  )
})
