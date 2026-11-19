import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("mixed bit rates use the latest of the individual channel end times", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 2, offsetMs: 8000 },
    { pattern: "00110", bitRateBps: 1 },
  ])
  assert.equal(defaultDurationSeconds(channels), 8 + 2 / 2)
})
