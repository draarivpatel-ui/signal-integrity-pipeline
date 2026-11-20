import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeNeighbors } from "../../../fixtures/copper-scope-board"

test("vias on a retained adjacent route are retained", async () => {
  const { scope } = await scopeNeighbors()
  assert.equal(
    scope.pcbViaIds.length,
    2,
    "vias on the retained adjacent route are included",
  )
})
