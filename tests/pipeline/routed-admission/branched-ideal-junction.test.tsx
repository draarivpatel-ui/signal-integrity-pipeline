import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "successive routed branches share one transitive ideal junction",
  async () => {
    const circuitJson = await renderSignals({
      tree: <AdmissionDaisyChain routeFinalLeg idealMiddleLeg branched />,
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
    const [driverCut, ...branchCuts] = bindings.routedTraceCuts
    assert.equal(branchCuts.length, 2)
    const junction = node(driverCut.toSourcePortId)
    assert.notEqual(node(driverCut.fromSourcePortId), junction)
    for (const cut of branchCuts) {
      assert.ok(
        [node(cut.fromSourcePortId), node(cut.toSourcePortId)].includes(
          junction,
        ),
      )
    }
    assert.deepEqual(
      bindings.mappings.map(
        ({ sourceTraceIds }) => sourceTraceIds?.length ?? 1,
      ),
      [1, 2, 2],
    )
  },
)
