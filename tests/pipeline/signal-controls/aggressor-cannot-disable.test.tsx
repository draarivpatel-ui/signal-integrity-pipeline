import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusAggressorControls,
} from "../../fixtures/parallel-bus"

test("an aggressor's output model must support the declared disabled state", async () => {
  await assert.rejects(
    parallelBusAggressorControls({
      tree: <ParallelBus aggressorDisabled />,
    }),
    /TX[.]DQ1.*LVC1G04_OUT_33.*has no disabled state/,
  )
})
