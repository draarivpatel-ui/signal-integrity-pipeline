import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeNeighbors } from "../../../fixtures/copper-scope-board"

test("return copper and a nearby other-net pour are retained", async () => {
  const { scope } = await scopeNeighbors()
  assert.equal(
    scope.pcbCopperPourIds.length,
    2,
    "return copper and nearby other-net plane remain visible",
  )
  assert.equal(
    scope.nearbyNonReferencePourIds.length,
    1,
    "the nearby other-net plane is recorded",
  )
})
