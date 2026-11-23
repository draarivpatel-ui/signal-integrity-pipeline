import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a named path leaves a separate unlabeled branch cut intact", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <AdmissionDaisyChain routeFinalLeg idealMiddleLeg namedNet branched />
    ),
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
  assert.equal(bindings.routedTraceCuts.length, 3)
  assert.equal(new Set(plan.sections.requiredSourcePortIds.map(node)).size, 4)
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 3,
    testPath: import.meta.path,
    caption: "The unlabeled branch shares the ideal junction with DATA",
  })
  assert.deepEqual(
    bindings.mappings.map(({ sourceTraceIds }) => sourceTraceIds?.length),
    [undefined, 2, 2],
  )
})
