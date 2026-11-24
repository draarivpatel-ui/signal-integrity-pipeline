import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveSectionCapacitance } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("electrostatic extraction checks resolution", () => {
  const section = sectionFixture({ kind: "microstrip", count: 1 })
  assert.throws(
    () => solveSectionCapacitance({ section, options: { panelsPerEdge: 2 } }),
    /panels per edge/,
  )
})
