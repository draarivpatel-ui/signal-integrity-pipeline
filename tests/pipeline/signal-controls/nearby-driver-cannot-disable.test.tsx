import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ParallelBus,
  parallelBusNeighborControls,
} from "../../fixtures/parallel-bus"

test("a nearby output model must support the declared disabled state", async () => {
  await assert.rejects(
    parallelBusNeighborControls({
      tree: <ParallelBus nearbyDriversDisabled />,
    }),
    /TX[.]DQ1.*LVC1G04_OUT_33.*has no disabled state/,
  )
})
