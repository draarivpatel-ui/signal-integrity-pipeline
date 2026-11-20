import { test } from "bun:test"
import assert from "node:assert/strict"
import { isQuiet } from "../../../src/board"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("a mixed literal pattern switches", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "001", bitRateBps: 1 },
  ])
  assert.equal(isQuiet(channel), false)
})
