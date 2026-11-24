import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test("replays RLGC calculation from serialized constructor parameters", async () => {
  const solver = new RouteFieldsSolver(await renderFieldsInput())
  solver.solve()
  const result = solver.getOutput()
  const repeat = new RouteFieldsSolver(
    JSON.parse(JSON.stringify(solver.getConstructorParams()[0])),
  )
  repeat.solve()
  assert.deepEqual(repeat.getOutput().artifacts, result.artifacts)
})
