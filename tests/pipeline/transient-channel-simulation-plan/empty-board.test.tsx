import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"

test("empty boards admit no fake channel simulations", () => {
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson: [],
    ibisSources: {},
  })
  solver.solve()
  assert.deepEqual(solver.getOutput().value, [])
})
