import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeCrossSection } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test.failing(
  "zero soldermask leaves the outer copper band and overcoat in air",
  async () => {
    const { geometry } = await renderFieldsInput()
    const wireSection = geometry.sections[0]
    const outerCopper = geometry.stackup.copperLayers.find(
      (layer) => layer.name === "top",
    )
    assert(outerCopper)
    const crossSection = routeCrossSection({
      geometry,
      slice: wireSection,
      materials: {
        maskMm: 0,
        maskEr: 3.3,
        maskLoss: 0.025,
        substrateLoss: 0.02,
      },
    })
    assert(
      crossSection.dielectrics.every(
        (layer) => layer.zMm + layer.thicknessMm <= outerCopper.zMinMm + 1e-12,
      ),
    )
  },
)
