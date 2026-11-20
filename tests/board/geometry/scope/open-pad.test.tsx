import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeNeighbors } from "../../../fixtures/copper-scope-board"

test("an unused disconnected lead is recorded as an open pad", async () => {
  const { scope } = await scopeNeighbors()
  assert.equal(
    scope.openPadIds.length,
    1,
    "unused disconnected leads retain their explicit open-pad approximation",
  )
})
