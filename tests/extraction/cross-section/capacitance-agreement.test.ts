import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  solveCrossSection,
  solveSectionCapacitance,
} from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("electrostatic and full capacitance agree", () => {
  for (const kind of ["microstrip", "stripline"] as const) {
    const section = sectionFixture({ kind, count: 2 })
    assert.deepEqual(
      solveSectionCapacitance({ section }),
      solveCrossSection({ section }).C,
    )
  }
}, 30_000)
