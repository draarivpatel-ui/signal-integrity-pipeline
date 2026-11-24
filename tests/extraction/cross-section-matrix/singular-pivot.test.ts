import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionFactor } from "../../../src/extraction/cross-section-matrix"

test("singular pivots fail", () => {
  assert.throws(() => sectionFactor([Float64Array.of(0)]), {
    code: "matrix_zero",
  })
})
