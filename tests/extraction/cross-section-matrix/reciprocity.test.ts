import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  sectionPassive,
  sectionReciprocity,
} from "../../../src/extraction/cross-section-matrix"

test("distinguishes zero, nonfinite and nonreciprocal coefficients", () => {
  assert.equal(sectionReciprocity([[0]]), 0)
  assert.ok(Number.isNaN(sectionReciprocity([[NaN]])))
  assert.throws(() => sectionPassive({ matrix: [[NaN]] }), {
    code: "matrix_format",
  })
  assert.throws(
    () =>
      sectionPassive({
        matrix: [
          [1, 0.5],
          [0, 1],
        ],
      }),
    { code: "reciprocity" },
  )
})
