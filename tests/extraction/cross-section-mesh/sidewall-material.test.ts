import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  sectionPanels,
  sectionRegions,
} from "../../../src/extraction/cross-section-mesh"

test("splits both conductor sidewalls at a dielectric boundary", () => {
  const [{ region }] = sectionRegions({
    conductors: [{ id: "s", xMm: 0, zMm: 0.8, widthMm: 1, thicknessMm: 0.4 }],
    planes: [{ zMm: 0 }, { zMm: 2 }],
    dielectrics: [
      { zMm: 0, thicknessMm: 1, er: 4, lossTangent: 0.02 },
      { zMm: 1, thicknessMm: 1, er: 3, lossTangent: 0.01 },
    ],
  })
  const panels = sectionPanels({ region, count: 12, extent: 24 })
  for (const side of [-1, 1]) {
    const sidewall = panels.filter(
      (panel) => panel.group === 0 && panel.tz === side,
    )
    assert.equal(sidewall.length, 8)
    assert.deepEqual(
      new Set(sidewall.map((panel) => panel.er)),
      new Set([3, 4]),
    )
    for (const panel of sidewall) assert.equal(panel.er, panel.z < 1 ? 4 : 3)
  }
})
