import { test } from "bun:test"
import assert from "node:assert/strict"
import { inlineVia } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an incorrectly approached via cannot lay copper on its incoming layer", async () => {
  const board = await inlineVia({ fromLayer: "bottom" })
  assert.throws(() => validate(board), { code: "channel_net" })
})
