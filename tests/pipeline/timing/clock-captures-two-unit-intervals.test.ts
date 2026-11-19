import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("clock captures two unit intervals", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 2 },
  ])
  assert.equal(defaultDurationSeconds(channels), 2 / 2)
})
