import { test } from "bun:test"
import assert from "node:assert/strict"
import { parallelTraces } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("overlapping 0.1 mm traces connect with their centrelines 0.05 mm apart", async () => {
  const board = await parallelTraces({ separation: 0.05 })
  assert.doesNotThrow(() => validate(board))
})
