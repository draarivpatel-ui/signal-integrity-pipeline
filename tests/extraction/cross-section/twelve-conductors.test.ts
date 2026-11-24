import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import {
  assertPositiveDefinite,
  sectionFixture,
} from "../../fixtures/cross-section"

test("twelve-line matrices preserve energy and signs", () => {
  for (const kind of ["microstrip", "mask", "stripline"] as const) {
    const result = solveCrossSection({
      section: sectionFixture({ kind, count: 12 }),
    })
    for (const matrix of [result.C, result.C0, result.L, result.skinResistance])
      assertPositiveDefinite(matrix)
    assert.ok(result.diagnostics.reciprocityResidual < 0.005)
    assert.ok(
      result.C.every((row, i) =>
        row.every((coefficient, j) => {
          if (i === j) return coefficient > 0
          return coefficient <= 0
        }),
      ),
    )
  }
}, 30_000)
