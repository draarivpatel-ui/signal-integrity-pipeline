import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("lower plane conductivity scales only the plane contribution", () => {
  const section = sectionFixture({ kind: "microstrip" })
  const base = solveCrossSection({ section })
  const mixed = solveCrossSection({
    section: {
      ...section,
      planes: [{ zMm: 0, conductivitySm: 5.8e7 / 4 }],
    },
  })
  const own = base.stripSkinResistance[0][0]
  const plane = base.skinResistance[0][0] - own
  assert.ok(plane > 0)
  assert.ok(Math.abs(mixed.stripSkinResistance[0][0] / own - 1) < 1e-5)
  assert.ok(Math.abs((mixed.skinResistance[0][0] - own) / plane - 2) < 1e-5)
  assert.deepEqual(mixed.dcResistance, base.dcResistance)
})
