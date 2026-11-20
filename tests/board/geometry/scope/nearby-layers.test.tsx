import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeNeighbors } from "../../../fixtures/copper-scope-board"

test("only same-layer and adjacent routes within reach are retained", async () => {
  const { scope, retained } = await scopeNeighbors()
  assert.deepEqual(retained.sort(), ["ADJACENT", "SAME", "SELECTED"])
  assert.equal(scope.omitted.traces, 2)
})
