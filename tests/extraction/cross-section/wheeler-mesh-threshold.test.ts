import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, solveCrossSection } from "../../../src/extraction"

test.failing(
  "halving Wheeler recession at an adaptive mesh threshold preserves both skin terms",
  () => {
    // Width is exactly six lower-plane clearances, where adaptive face counts increase.
    const section: CrossSection = {
      conductors: [
        { id: "s", xMm: 0, zMm: 0.125, widthMm: 0.75, thicknessMm: 0.035 },
      ],
      planes: [{ zMm: 0 }],
      dielectrics: [],
    }
    const full = solveCrossSection({ section })
    const half = solveCrossSection({
      section,
      options: { recessionFraction: 0.005 },
    })
    assert.ok(
      Math.abs(half.skinResistance[0][0] / full.skinResistance[0][0] - 1) <
        0.001,
    )
    assert.ok(
      Math.abs(
        half.stripSkinResistance[0][0] / full.stripSkinResistance[0][0] - 1,
      ) < 0.001,
    )
  },
)
