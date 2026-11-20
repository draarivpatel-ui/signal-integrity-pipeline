import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeNeighbors } from "../../../fixtures/copper-scope-board"

test("a connected neighbor without a trace is recorded as a pad-only port", async () => {
  const { scope } = await scopeNeighbors()
  assert.equal(
    scope.padOnlySourcePortIds.length,
    1,
    "the pad-only neighbour port is recorded",
  )
})
