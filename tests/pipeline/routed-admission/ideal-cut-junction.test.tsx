import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("an ideal wire can join successive cuts on one partial receiver path", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionDaisyChain routeFinalLeg idealMiddleLeg />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const [junction] = bindings.idealRoutedJunctions
  assert.ok(junction)
  const { node } = circuitNodes({ ...bindings, circuit: bindings.circuitJson })
  const middleNode = node(junction.fromSourcePortId)
  assert.equal(middleNode, node(junction.toSourcePortId))
  assert.equal(bindings.mappings[1]?.sourceTraceIds?.length, 2)
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 2,
    testPath: import.meta.path,
    caption: `MID.A and JOIN.A share ${middleNode} on the ideal leg`,
  })
})
