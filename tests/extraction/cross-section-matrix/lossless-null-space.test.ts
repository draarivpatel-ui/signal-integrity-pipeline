import { test } from "bun:test"
import { sectionPassive } from "../../../src/extraction/cross-section-matrix"

test("loss may have a null space", () => {
  sectionPassive({
    matrix: [
      [0, 0],
      [0, 1],
    ],
  })
})
