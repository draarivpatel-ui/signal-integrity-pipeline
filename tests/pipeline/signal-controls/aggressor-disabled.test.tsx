import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusAggressorControls,
  threeStateParallelBusSources,
} from "../../fixtures/parallel-bus"

test("a disabled aggressor has no stimulus even if a pattern is set", async () => {
  const { state, stimulus } = await parallelBusAggressorControls({
    tree: <ParallelBus aggressorDisabled aggressorPattern="clock" />,
    sources: threeStateParallelBusSources,
  })
  assert.equal(state?.is_output, true)
  assert.equal(state?.is_output_enabled, false)
  assert.equal(stimulus, undefined)
})
