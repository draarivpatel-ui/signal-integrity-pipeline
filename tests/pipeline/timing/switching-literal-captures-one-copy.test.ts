import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("a switching literal captures one copy of its bit string", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "00110", bitRateBps: 2 },
  ])
  assert.equal(defaultDurationSeconds(channels), 5 / 2)
})
