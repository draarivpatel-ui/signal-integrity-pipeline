import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusAggressorControls,
} from "../../fixtures/parallel-bus"

test("an aggressor holds the declared quiet low level", async () => {
  const { state, stimulus } = await parallelBusAggressorControls({
    tree: <ParallelBus aggressorPattern="0" />,
  })
  assert.equal(state?.is_output_enabled, true)
  assert.equal(stimulus?.initial_state, 0)
  assert.equal(stimulus?.transmission_pattern.bits, "0")
})
