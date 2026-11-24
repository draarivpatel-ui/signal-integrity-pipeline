import { test } from "bun:test"
import { drawCrossSection } from "../../fixtures/cross-section-drawing"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"

test("draws dielectric panels and sidewall splits between two reference planes", () => {
  const drawing = drawCrossSection({
    crossSection: {
      conductors: [
        { conductorId: "s", xMm: 0, zMm: 0.8, widthMm: 1, thicknessMm: 0.4 },
      ],
      planes: [{ zMm: 0 }, { zMm: 2 }],
      dielectricLayers: [
        { zMm: 0, thicknessMm: 1, relativePermittivity: 4, lossTangent: 0.02 },
        { zMm: 1, thicknessMm: 1, relativePermittivity: 3, lossTangent: 0.01 },
      ],
    },
    halfWidthMm: 2.1,
    title: "Layered stripline · boundary mesh detail",
  })
  assertPlanDrawingSnapshot({
    drawing,
    module: "rlgc",
    name: "layered-stripline-mesh",
    trimTrailingWhitespace: true,
  })
})
