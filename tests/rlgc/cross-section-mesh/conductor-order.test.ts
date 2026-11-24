import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { sectionFixture } from "../../fixtures/cross-section"

test("preserves conductor ordering", () => {
  const crossSection = sectionFixture({ kind: "mask", count: 2 })
  const original = calculateRlgc({ crossSection })
  const permuted = calculateRlgc({
    crossSection: {
      ...crossSection,
      conductors: [...crossSection.conductors].reverse(),
    },
  })
  for (const key of [
    "capacitanceFaradsPerMeter",
    "vacuumCapacitanceFaradsPerMeter",
    "externalInductanceHenriesPerMeter",
    "totalSkinResistanceOhmsPerMeterPerSqrtHz",
    "dielectricLossFaradsPerMeter",
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
