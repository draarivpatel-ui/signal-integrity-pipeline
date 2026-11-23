import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a named net reports its bypassed cuts as a short", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionDaisyChain routeFinalLeg bypassFinalLeg namedNet />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  assert.throws(
    () => {
      const solver = new RoutedAdmissionSolver({
        circuitJson,
        ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
      })
      solver.solve()
      const [{ bindings }] = solver.getOutput().value
      circuitNodes({ ...bindings, circuit: bindings.circuitJson })
    },
    { code: "channel_short" },
  )
})
