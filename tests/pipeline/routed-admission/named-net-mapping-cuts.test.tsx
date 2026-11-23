import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "mapping-only multi-receiver paths cut each routed trace once",
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
    assert.equal(bindings.mappings.length, 2)
    assert.equal(bindings.mappings[1].sourceTraceIds?.length, 2)
    const { node } = circuitNodes({
      circuit: bindings.circuitJson,
      modeling: bindings.modeling,
      mappings: bindings.mappings,
    })
    assert.equal(new Set(plan.sections.requiredSourcePortIds.map(node)).size, 3)
  },
)
