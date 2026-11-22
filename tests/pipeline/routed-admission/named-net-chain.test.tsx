import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a named net can be split along a two-cut routed path", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionDaisyChain routeFinalLeg namedNet />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const { node } = circuitNodes({
    ...bindings,
    circuit: bindings.circuitJson,
  })
  assert.equal(new Set(plan.sections.requiredSourcePortIds.map(node)).size, 3)
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 2,
    testPath: import.meta.path,
    idealConnection: "DATA names the full two-cut path",
  })
})
