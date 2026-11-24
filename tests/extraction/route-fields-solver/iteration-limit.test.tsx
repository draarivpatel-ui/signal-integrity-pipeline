import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test("completes the pair screen and group calculation in separate steps", async () => {
  const solver = new RouteFieldsSolver(await renderFieldsInput())
  assert.equal(solver.MAX_ITERATIONS, Infinity)
  solver.step()
  assert.equal(solver.stats.screenedPairCount, 1)
  assert.equal(solver.stats.solvedSectionCount, 0)
  solver.step()
  assert.equal(solver.stats.solvedSectionCount, 1)
  solver.solve()
  assert.equal(solver.solved, true)
})
