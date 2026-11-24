import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver, referenceSeries } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test.failing(
  "validates grounded-conductor indices before projecting series matrices",
  async () => {
    const solver = new RouteFieldsSolver(await renderFieldsInput())
    solver.solve()
    const { line } = solver.getOutput().value.slices[0]
    assert.equal(line.L.length, 2)
    for (const grounded of [[-1], [2], [0.5], [1, 1]]) {
      assert.throws(
        () => referenceSeries({ line, grounded }),
        /Grounded conductor indices/,
      )
    }
    const series = referenceSeries({ line, grounded: [1] })
    const expected = line.L[0][0] - line.L[0][1] ** 2 / line.L[1][1]
    assert(Math.abs(series.L[0][0] / expected - 1) < 1e-12)
    const conductorCurrentRatio = -line.L[0][1] / line.L[1][1]
    const resistance = line.stripSkinResistance
    const expectedSkin =
      resistance[0][0] +
      2 * conductorCurrentRatio * resistance[0][1] +
      conductorCurrentRatio ** 2 * resistance[1][1]
    assert(
      Math.abs(series.stripSkinResistance[0][0] / expectedSkin - 1) < 1e-12,
    )
    assert(Object.isFrozen(series.L))
    assert.deepEqual(
      Object.keys(referenceSeries({ line, grounded: [] })),
      Object.keys(series),
    )
  },
)
