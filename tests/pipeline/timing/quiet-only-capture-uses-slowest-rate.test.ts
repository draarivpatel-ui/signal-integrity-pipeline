import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("quiet-only capture is one unit interval at the slowest rate from time zero", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "111", bitRateBps: 2, offsetMs: 100_000 },
    { pattern: "00", bitRateBps: 1, offsetMs: 200_000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 1)
})
