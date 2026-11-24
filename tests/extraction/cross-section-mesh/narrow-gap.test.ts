import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"

test("limits recession across a narrow gap", () => {
  const close = solveCrossSection({
    section: {
      conductors: [
        {
          id: "a",
          xMm: 0,
          zMm: 0.1,
          widthMm: 0.1,
          thicknessMm: 0.035,
        },
        {
          id: "b",
          xMm: 0.1002,
          zMm: 0.1,
          widthMm: 0.1,
          thicknessMm: 0.035,
        },
      ],
      planes: [{ zMm: 0 }],
      dielectrics: [],
    },
  })
  assert.ok(close.diagnostics.recessionMm < 0.0002 / 4)
})
