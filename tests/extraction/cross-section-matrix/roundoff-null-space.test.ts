import { test } from "bun:test"
import { sectionPassive } from "../../../src/extraction/cross-section-matrix"

test("accepts a loss null space with a near-zero positive pivot", () => {
  sectionPassive({
    matrix: [
      [1e-24, 2e-10],
      [2e-10, 1],
    ],
  })
  // A genuinely positive semidefinite matrix can have a small pivot with finite coupling.
  sectionPassive({
    matrix: [
      [1e-12, 1e-6],
      [1e-6, 1],
    ],
  })
})
