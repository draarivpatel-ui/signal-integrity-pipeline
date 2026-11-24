import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  solveFieldsCopper,
  withStackupLayers,
} from "../../fixtures/fields-input"
import { renderRoutedCopper } from "../../fixtures/routed-copper"

test("conductivity changes conductor and plane resistance and cross-section identity", async () => {
  const board = await renderRoutedCopper()
  const defaultCopper = 5.8e7
  const results = [defaultCopper, defaultCopper / 4].map((conductivitySm) => {
    const circuitJson = withStackupLayers({
      circuitJson: board.circuitJson,
      transform: (layers) =>
        layers.map((layer) =>
          layer.layer_type === "copper"
            ? { ...layer, electrical_conductivity_s_per_m: conductivitySm }
            : layer,
        ),
    })
    const copper = solveFieldsCopper({ ...board, circuitJson })
    const solver = new RouteFieldsSolver({
      copperGeometry: copper,
      artifactPrefix: "test",
    })
    solver.solve()
    return solver.getOutput().value.solvedWireSections[0]
  })
  const [baseline, resistive] = results
  assert.notEqual(resistive.crossSectionKey, baseline.crossSectionKey)
  assert.equal(
    resistive.rlgcMatrices.dcResistanceOhmsPerMeter[0][0] /
      baseline.rlgcMatrices.dcResistanceOhmsPerMeter[0][0],
    4,
  )
  for (const kind of [
    "totalSkinResistanceOhmsPerMeterPerSqrtHz",
    "conductorSkinResistanceOhmsPerMeterPerSqrtHz",
  ] as const) {
    assert.ok(
      Math.abs(
        resistive.rlgcMatrices[kind][0][0] / baseline.rlgcMatrices[kind][0][0] -
          2,
      ) < 1e-9,
    )
  }
  const crossSection = JSON.parse(resistive.crossSectionKey)
  assert.equal(crossSection.conductors[0].conductivitySm, defaultCopper / 4)
  assert.equal(crossSection.planes[0].conductivitySm, defaultCopper / 4)
})
