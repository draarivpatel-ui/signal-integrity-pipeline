import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("reflects an upper reference plane", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  const original = solveCrossSection({ section })
  const reflected = solveCrossSection({
    section: {
      conductors: section.conductors.map((c) => ({
        ...c,
        zMm: -c.zMm - c.thicknessMm,
      })),
      planes: section.planes,
      dielectrics: section.dielectrics.map((d) => ({
        ...d,
        zMm: -d.zMm - d.thicknessMm,
      })),
    },
  })
  for (const key of ["C", "L"] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(original[key][i][j] / reflected[key][i][j] - 1) < 1e-8,
        )
      }
    }
  }
})
