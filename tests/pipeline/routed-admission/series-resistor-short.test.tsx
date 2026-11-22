import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("rejects an ideal resistor short across a routed series channel", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="series" short="resistor" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.routedTraceCuts.length, 2)
  assert.equal(bindings.mappings[0]?.sourceTraceIds?.length, 2)
  assert.throws(
    () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
    {
      domain: "simulation",
      code: "channel_short",
    },
  )
})
