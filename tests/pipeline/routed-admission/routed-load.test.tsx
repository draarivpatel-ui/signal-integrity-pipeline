import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("a routed load past the declared receiver remains an extracted trace", async () => {
  const circuitJson = await renderCoreSignals(
    <AdmissionDaisyChain routeFinalLeg />,
  )
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { requiredSourcePortIds } = plan.sections
  assert.equal(requiredSourcePortIds.length, 3)
  assert.equal(new Set(requiredSourcePortIds).size, 3)
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 2,
    testPath: import.meta.path,
  })
})
