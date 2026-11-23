import { test } from "bun:test"
import assert from "node:assert/strict"
import { circuitJsonDb } from "../../../src/board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a wholly ideal single-ended channel still rejects a grounded signal contact", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="unrouted" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const [{ driver }] = circuitJsonDb(
    bindings.circuitJson,
  ).simulation_pcb_driver_receiver_channel.list()
  assert.ok("source_port_id" in driver)
  assert.deepEqual(bindings.mappings, [])
  assert.deepEqual(bindings.routedTraceCuts, [])
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: bindings.circuitJson,
        modeling: {
          ...bindings.modeling,
          channelReference: { sourcePortId: driver.source_port_id },
        },
      }),
    {
      domain: "simulation",
      code: "channel_short",
      message: new RegExp(`${driver.source_port_id}.*ground`),
    },
  )
})
