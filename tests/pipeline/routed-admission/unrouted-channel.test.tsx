import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("allowed unrouted channels retain ideal source connectivity", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="unrouted" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  assert.deepEqual(bindings.mappings, [])
  assert.deepEqual(sections.requiredSourcePortIds, [])
  const [signal] =
    cju(circuitJson).simulation_pcb_driver_receiver_channel.list()
  assert.ok(
    signal &&
      "source_port_id" in signal.driver &&
      "source_port_id" in signal.receivers[0],
  )
  const { node } = circuitNodes({
    ...bindings,
    circuit: bindings.circuitJson,
  })
  assert.equal(
    node(signal.driver.source_port_id),
    node(signal.receivers[0].source_port_id),
  )
})
