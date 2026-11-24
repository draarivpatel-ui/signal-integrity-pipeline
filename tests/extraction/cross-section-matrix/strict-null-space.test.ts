import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionPassive } from "../../../src/extraction/cross-section-matrix"

test("strict passivity rejects a null space", () => {
  assert.throws(() => sectionPassive({ matrix: [[0]], strict: true }), {
    code: "passivity",
  })
})
