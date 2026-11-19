import { test } from "bun:test"
import assert from "node:assert/strict"
import { isQuiet } from "../../../src/board"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("repeated high bits are quiet", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "111", bitRateBps: 1 },
  ])
  assert.equal(isQuiet(channel), true)
})
