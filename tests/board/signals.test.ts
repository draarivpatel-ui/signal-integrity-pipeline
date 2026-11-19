import { test } from "bun:test"
import assert from "node:assert/strict"
import { isQuiet } from "../../src/board"
import { driverReceiverChannels } from "../fixtures/driver-receiver-channel"

test("a single low bit is quiet", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "0", bitRateBps: 1 },
  ])
  assert.equal(isQuiet(channel), true)
})

test("repeated high bits are quiet", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "111", bitRateBps: 1 },
  ])
  assert.equal(isQuiet(channel), true)
})

test("a mixed literal pattern switches", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "001", bitRateBps: 1 },
  ])
  assert.equal(isQuiet(channel), false)
})

test("a disabled driver is quiet even with a switching pattern", async () => {
  const [channel] = await driverReceiverChannels([
    { pattern: "clock", bitRateBps: 1, driverDisabled: true },
  ])
  assert.equal(isQuiet(channel), true)
})
