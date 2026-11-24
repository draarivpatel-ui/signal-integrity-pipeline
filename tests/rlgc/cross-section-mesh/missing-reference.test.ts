import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { sectionFixture } from "../../fixtures/cross-section"

test("requires a reference plane", () => {
  const crossSection = sectionFixture({ kind: "mask", count: 2 })
  assert.throws(
    () => calculateRlgc({ crossSection: { ...crossSection, planes: [] } }),
    { code: "cross_section_geometry" },
  )
})
