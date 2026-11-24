import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { LIGHT_SPEED, microstripFixture } from "../../fixtures/cross-section"
import { thickMicrostrip } from "../../fixtures/cross-section-reference"

test("thick microstrip matches Hammerstad–Jensen", () => {
  // Normalize the 100 um width and 35 um thickness to the 99.4 um reference height.
  const width = 0.1 / 0.0994
  const thickness = 0.035 / 0.0994
  const thick = solveCrossSection({
    section: microstripFixture({
      width,
      gap: 0,
      er: 4.1,
      count: 1,
      thickness,
    }),
  })
  const referenceThick = thickMicrostrip({ width, er: 4.1, thickness })
  const thickC = Math.sqrt(referenceThick.ee) / (LIGHT_SPEED * referenceThick.z)
  const thickL = (referenceThick.z * Math.sqrt(referenceThick.ee)) / LIGHT_SPEED
  const thickZ = Math.sqrt(thick.L[0][0] / thick.C[0][0])
  const thickError = Math.max(
    Math.abs(thickZ / referenceThick.z - 1),
    Math.abs(thick.C[0][0] / thickC - 1),
    Math.abs(thick.L[0][0] / thickL - 1),
  )
  assert.ok(
    thickError < 0.02,
    `finite thickness Hammerstad–Jensen C/L/Z: ${thickError}`,
  )
})
