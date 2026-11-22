import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "a redundant named net preserves the ideal junction between two cuts",
  async () => {
    const circuitJson = await renderSignals({
      tree: <AdmissionDaisyChain routeFinalLeg idealMiddleLeg namedNet />,
      expectedErrors: [
        "pcb_trace_missing_error",
        "pcb_port_not_connected_error",
      ],
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
    const [driverCut, receiverCut] = bindings.routedTraceCuts
    const middleNode = node(driverCut.toSourcePortId)
    assert.ok(
      [
        node(receiverCut.fromSourcePortId),
        node(receiverCut.toSourcePortId),
      ].includes(middleNode),
    )
    assert.equal(new Set(plan.sections.requiredSourcePortIds.map(node)).size, 3)
    assert.equal(bindings.mappings[1]?.sourceTraceIds?.length, 2)
    expectAdmissionPcbSnapshot({
      circuitJson,
      plan,
      expectedTraceCount: 2,
      testPath: import.meta.path,
      caption: `DATA names both cuts; MID.A and JOIN.A share ${middleNode}`,
    })
  },
)
