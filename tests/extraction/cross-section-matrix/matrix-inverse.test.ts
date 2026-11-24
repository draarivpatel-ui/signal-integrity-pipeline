import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionInverse } from "../../../src/extraction/cross-section-matrix"

test("inverse uses pivoted factors", () => {
  const inverse = sectionInverse([
    [2, 1],
    [1, 2],
  ])
  assert.ok(Math.abs(inverse[0][0] - 2 / 3) < 1e-14)
})
