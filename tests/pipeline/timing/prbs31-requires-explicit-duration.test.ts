import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../../src/pipeline/timing"
import { driverReceiverChannels } from "../../fixtures/driver-receiver-channel"

test("PRBS31 requires an explicit duration", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "prbs31", bitRateBps: 2 },
  ])
  assert.throws(
    () => defaultDurationSeconds(channels),
    /DATA0: PRBS15 and PRBS31 need an explicit duration/,
  )
})
