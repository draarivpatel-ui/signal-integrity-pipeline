import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusNeighborControls,
} from "../../fixtures/parallel-bus"

test("a nearby driver switches from time zero at the simulation bit rate", async () => {
  const { durationSeconds, state, stimulus } =
    await parallelBusNeighborControls({
      tree: <ParallelBus driverBitRate="40Mbps" nearbyDriverPattern="prbs7" />,
    })
  assert.equal(state?.is_output_enabled, true)
  assert.equal(durationSeconds, 127 / 20e6)
  assert.equal(stimulus?.bit_duration_ms, 1000 / 20e6)
  assert.equal(stimulus?.start_time_ms, 0)
  const bits = stimulus?.transmission_pattern.bits
  assert.equal(bits?.length, 127)
  assert.equal(bits?.includes("0"), true)
  assert.equal(bits?.includes("1"), true)
})
