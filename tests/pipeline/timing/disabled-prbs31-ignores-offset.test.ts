import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("a disabled PRBS31 driver is quiet and its offset is ignored", async () => {
  const channels = await driverReceiverChannels([
    {
      pattern: "prbs31",
      bitRateBps: 2,
      offsetMs: 100_000,
      driverDisabled: true,
    },
  ])
  assert.equal(defaultDurationSeconds(channels), 1 / 2)
})
