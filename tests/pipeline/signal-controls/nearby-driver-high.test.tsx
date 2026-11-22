import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusNeighborControls,
} from "../../fixtures/parallel-bus"

test("a nearby driver holds the declared quiet high level", async () => {
  const { state, stimulus } = await parallelBusNeighborControls({
    tree: <ParallelBus nearbyDriverPattern="1" />,
  })
  assert.equal(state?.is_output_enabled, true)
  assert.equal(stimulus?.initial_state, 1)
  assert.equal(stimulus?.transmission_pattern.bits, "1")
})
