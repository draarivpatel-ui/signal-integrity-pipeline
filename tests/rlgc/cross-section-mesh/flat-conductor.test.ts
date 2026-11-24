import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects a flat conductor", () => {
  const crossSection = sectionFixture({ kind: "mask", count: 2 })
  const flat = [{ ...crossSection.conductors[0], thicknessMm: 0 }]
  assert.throws(
    () =>
      calculateRlgc({ crossSection: { ...crossSection, conductors: flat } }),
    { code: "cross_section_geometry" },
  )
})
