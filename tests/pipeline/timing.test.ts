import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../src/pipeline/timing"
import { driverReceiverChannels } from "../fixtures/driver-receiver-channel"

test("a switching channel gets 16 startup and 128 eye unit intervals", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 1 },
  ])
  assert.equal(defaultDurationSeconds(channels), 16 + 128)
})

test("a switching channel offset delays capture", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 2, offsetMs: 3000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 3 + 16 * 0.5 + 128 * 0.5)
})

test("the latest switching startup sets the start of the eye window", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "prbs31", bitRateBps: 2, offsetMs: 3000 },
    { pattern: "00110", bitRateBps: 2 },
  ])
  assert.equal(defaultDurationSeconds(channels), 3 + 16 * 0.5 + 128 * 0.5)
})

test("the slowest switching bit rate sets the eye window length", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "prbs31", bitRateBps: 2, offsetMs: 8000 },
    { pattern: "00110", bitRateBps: 1 },
  ])
  assert.equal(defaultDurationSeconds(channels), 16 + 128)
})

test("constant patterns capture 32 unit intervals regardless of offset", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "1", bitRateBps: 2, offsetMs: 100_000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 32 * 0.5)
})

test("the slowest quiet bit rate sets the capture length", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "1", bitRateBps: 2 },
    { pattern: "0", bitRateBps: 1 },
  ])
  assert.equal(defaultDurationSeconds(channels), 32)
})

test("a disabled driver captures 32 unit intervals regardless of offset", async () => {
  const channels = await driverReceiverChannels([
    {
      pattern: "prbs31",
      bitRateBps: 2,
      offsetMs: 100_000,
      driverDisabled: true,
    },
  ])
  assert.equal(defaultDurationSeconds(channels), 32 * 0.5)
})

test("a disabled channel can set the bit rate for a quiet-only capture", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "1", bitRateBps: 2 },
    { pattern: "clock", bitRateBps: 1, driverDisabled: true },
  ])
  assert.equal(defaultDurationSeconds(channels), 32)
})

test("quiet channels leave the switching capture length unchanged", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 2, offsetMs: 3000 },
    { pattern: "0", bitRateBps: 1, offsetMs: 100_000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 3 + 16 * 0.5 + 128 * 0.5)
})
