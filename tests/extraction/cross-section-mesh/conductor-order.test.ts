import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("preserves conductor ordering", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  const original = solveCrossSection({ section })
  const permuted = solveCrossSection({
    section: { ...section, conductors: [...section.conductors].reverse() },
  })
  for (const key of [
    "C",
    "C0",
    "L",
    "skinResistance",
    "dielectricLoss",
  ] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(original[key][i][j] / permuted[key][1 - i][1 - j] - 1) <
            1e-8,
        )
      }
    }
  }
})
