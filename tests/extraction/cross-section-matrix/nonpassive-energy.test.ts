import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionPassive } from "../../../src/extraction/cross-section-matrix"

test("nonpassive energy fails", () => {
  assert.throws(
    () =>
      sectionPassive({
        matrix: [
          [1, 2],
          [2, 1],
        ],
      }),
    { code: "passivity" },
  )
})
