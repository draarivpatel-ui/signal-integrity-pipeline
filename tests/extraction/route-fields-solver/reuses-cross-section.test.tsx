import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test("reuses canonical pair geometry", async () => {
  const solver = new RouteFieldsSolver(await renderFieldsInput())
  solver.step()
  assert.equal(solver.solved, false)
  assert.equal(solver.stats.uniqueSolveCount, 1)
  solver.solve()
  const result = solver.getOutput()
  assert.equal(result.value.crossSectionSolutions.length, 1)
  assert.equal(solver.stats.cacheHitCount, 1)
})
