import { test } from "bun:test"
import assert from "node:assert/strict"
import { defaultDurationSeconds } from "../../src/pipeline/timing"
import { driverReceiverChannels } from "../fixtures/driver-receiver-channel"

test("PRBS7 captures 127 unit intervals after its offset", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "prbs7", bitRateBps: 2, offsetMs: 3000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 3 + 127 / 2)
})

test("clock captures two unit intervals", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 2 },
  ])
  assert.equal(defaultDurationSeconds(channels), 2 / 2)
})

test("a switching literal captures one copy of its bit string", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "00110", bitRateBps: 2 },
  ])
  assert.equal(defaultDurationSeconds(channels), 5 / 2)
})

test("quiet-only capture is one unit interval at the slowest rate from time zero", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "111", bitRateBps: 2, offsetMs: 100_000 },
    { pattern: "00", bitRateBps: 1, offsetMs: 200_000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 1)
})

test("mixed bit rates use the latest of the individual channel end times", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 2, offsetMs: 8000 },
    { pattern: "00110", bitRateBps: 1 },
  ])
  assert.equal(defaultDurationSeconds(channels), 8 + 2 / 2)
})

test("PRBS15 requires an explicit duration", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "prbs15", bitRateBps: 2 },
  ])
  assert.throws(
    () => defaultDurationSeconds(channels),
    /DATA0: PRBS15 and PRBS31 need an explicit duration/,
  )
})

test("PRBS31 requires an explicit duration", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "prbs31", bitRateBps: 2 },
  ])
  assert.throws(
    () => defaultDurationSeconds(channels),
    /DATA0: PRBS15 and PRBS31 need an explicit duration/,
  )
})

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

test("a quiet channel can outlast a faster switching channel", async () => {
  const channels = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 4 },
    { pattern: "0", bitRateBps: 1, offsetMs: 100_000 },
  ])
  assert.equal(defaultDurationSeconds(channels), 1)
})
