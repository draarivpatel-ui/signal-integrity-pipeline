import { test } from "bun:test"
import assert from "node:assert/strict"
import { mismatchedViaEntry } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an incorrectly approached via cannot lay copper on its incoming layer", async () => {
  const board = await mismatchedViaEntry()
  assert.ok(
    board.circuit.some(
      (record) =>
        record.type === "pcb_trace" &&
        record.route.some((point) => point.route_type === "via"),
    ),
  )
  assert.throws(() => validate(board), { code: "channel_net" })
})
