import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("rejects a differential short through internally connected pins", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential internalShort />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  assert.equal(bindings.routedTraceCuts.length, 2)
  assert.throws(
    () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
    { domain: "simulation", code: "channel_short" },
  )
})
