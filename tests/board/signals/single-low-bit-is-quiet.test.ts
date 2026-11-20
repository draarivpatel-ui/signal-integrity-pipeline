import { test } from "bun:test"
import assert from "node:assert/strict"
import { isQuiet } from "../../../src/board"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("a single low bit is quiet", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "0", bitRateBps: 1 },
  ])
  assert.equal(isQuiet(channel), true)
})
