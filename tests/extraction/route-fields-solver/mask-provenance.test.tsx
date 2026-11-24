import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  solveFieldsCopper,
  withStackupLayers,
} from "../../fixtures/fields-input"
import { renderRoutedCopper } from "../../fixtures/routed-copper"

test.failing(
  "publishes stackup, explicit, and assumed mask thickness provenance",
  async () => {
    const board = await renderRoutedCopper()
    const unmasked = solveFieldsCopper(board)
    assert.equal(unmasked.maskThicknessMm, null)
    const mask = { layer_type: "soldermask", thickness: 0.031 } as const
    const masked = solveFieldsCopper({
      ...board,
      circuitJson: withStackupLayers({
        circuitJson: board.circuitJson,
        transform: (layers) => [mask, ...layers, mask],
      }),
    })
    assert.equal(masked.maskThicknessMm, 0.031)
    const cases = [
      { copper: masked, source: "stackup", thicknessMm: 0.031 },
      { copper: unmasked, source: "assumed", thicknessMm: 0.02 },
      {
        copper: masked,
        materials: {
          maskMm: 0,
          maskEr: 3.3,
          maskLoss: 0.025,
          substrateLoss: 0.02,
        },
        source: "explicit",
        thicknessMm: 0,
      },
    ]
    for (const { copper, materials, source, thicknessMm } of cases) {
      const solver = new RouteFieldsSolver({
        geometry: copper.geometry,
        maskThicknessMm: copper.maskThicknessMm,
        materials,
        artifactPrefix: "test",
      })
      solver.solve()
      const [artifact] = solver.getOutput().artifacts
      const published = JSON.parse(artifact.body)
      assert.equal(published.materials.maskMm, thicknessMm)
      assert.equal(published.maskThicknessSource, source)
    }
  },
)
