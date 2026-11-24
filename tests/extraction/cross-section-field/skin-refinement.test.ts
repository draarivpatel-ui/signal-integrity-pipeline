import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("both skin matrices refine on coupled microstrip and stripline", () => {
  for (const kind of ["microstrip", "stripline"] as const) {
    const section = sectionFixture({ kind, count: 2 })
    const base = solveCrossSection({ section, options: { panelsPerEdge: 32 } })
    const fine = solveCrossSection({ section, options: { panelsPerEdge: 48 } })
    for (const key of ["skinResistance", "stripSkinResistance"] as const) {
      for (const [i, row] of fine[key].entries()) {
        for (const [j, coefficient] of row.entries()) {
          const change = Math.abs(base[key][i][j] / coefficient - 1)
          assert.ok(change < 0.01, `${kind} ${key} [${i},${j}]: ${change}`)
        }
      }
    }
  }
})
