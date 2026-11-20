import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("PRBS7 captures 127 unit intervals after its offset", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "prbs7", bitRateBps: 2, offsetMs: 3000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 3 + 127 / 2)
})
