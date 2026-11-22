import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusNeighborControls,
  threeStateParallelBusSources,
} from "../../fixtures/parallel-bus"

test("a disabled nearby driver has no stimulus even if a pattern is set", async () => {
  const { state, stimulus } = await parallelBusNeighborControls({
    tree: <ParallelBus nearbyDriversDisabled nearbyDriverPattern="clock" />,
    sources: threeStateParallelBusSources,
  })
  assert.equal(state?.is_output, true)
  assert.equal(state?.is_output_enabled, false)
  assert.equal(stimulus, undefined)
})
