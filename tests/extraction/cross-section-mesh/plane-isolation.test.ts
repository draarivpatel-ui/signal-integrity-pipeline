import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("isolates fields across a plane", () => {
  const section = sectionFixture({ kind: "mask", count: 2 })
  const shielded = solveCrossSection({
    section: {
      ...section,
      conductors: [
        section.conductors[0],
        { ...section.conductors[1], zMm: -1.035 },
      ],
      dielectrics: [],
    },
  })
  for (const matrix of [
    shielded.C,
    shielded.C0,
    shielded.L,
    shielded.skinResistance,
    shielded.dielectricLoss,
  ]) {
    assert.equal(matrix[0][1], 0)
  }
})
