import { test } from "bun:test"
import assert from "node:assert/strict"
import { isQuiet } from "../../../src/board"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("a disabled driver is quiet even with a switching pattern", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 1, driverDisabled: true },
  ])
  assert.equal(isQuiet(channel), true)
})
