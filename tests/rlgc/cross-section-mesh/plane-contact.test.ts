import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects a conductor touching a plane", () => {
  const crossSection = sectionFixture({ kind: "mask", count: 2 })
  const touchingPlane = [{ ...crossSection.conductors[0], zMm: 0 }]
  assert.throws(
    () =>
      calculateRlgc({
        crossSection: { ...crossSection, conductors: touchingPlane },
      }),
    { code: "cross_section_geometry" },
  )
})
