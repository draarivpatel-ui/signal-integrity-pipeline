import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("a quiet channel can outlast a faster switching channel", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 4 },
    { pattern: "0", bitRateBps: 1, offsetMs: 100_000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 1)
})
