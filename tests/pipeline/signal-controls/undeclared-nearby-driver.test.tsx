import { test } from "bun:test"
import assert from "node:assert/strict"
import { ParallelBus, parallelBusSources } from "../../fixtures/parallel-bus"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("admission requires a state for retained nearby drivers", async () => {
  const circuit = await renderSignals({ tree: <ParallelBus /> })
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: parallelBusSources }),
    /TX[.]DQ1.*nearbyDriverPattern.*nearbyDriversDisabled/,
  )
})
