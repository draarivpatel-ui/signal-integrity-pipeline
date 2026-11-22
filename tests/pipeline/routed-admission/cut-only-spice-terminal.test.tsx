import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { generalDeclarations } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "a cut-only contact must be mapped by its placed SPICE model",
  async () => {
    const circuitJson = await renderSignals({
      tree: <AdmissionDaisyChain routeFinalLeg placedLoad />,
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
    assert.equal(bindings.routedTraceCuts.length, 3)
    assert.throws(
      () => generalDeclarations({ ...bindings, circuit: bindings.circuitJson }),
      { domain: "simulation", code: "channel_model" },
    )
  },
)
