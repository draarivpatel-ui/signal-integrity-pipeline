import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusNeighborControls,
} from "../../fixtures/parallel-bus"

test("a nearby driver holds the declared quiet low level", async () => {
  const { state, stimulus } = await parallelBusNeighborControls({
    tree: <ParallelBus nearbyDriverPattern="0" />,
  })
  assert.equal(state?.is_output_enabled, true)
  assert.equal(stimulus?.initial_state, 0)
  assert.equal(stimulus?.transmission_pattern.bits, "0")
})
