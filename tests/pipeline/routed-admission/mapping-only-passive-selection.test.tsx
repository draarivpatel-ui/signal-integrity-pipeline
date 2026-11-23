import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { generalDeclarations } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "mapping-only declarations require the selected model for physical cut contacts",
  async () => {
    const circuitJson = await renderSignals({
      tree: <AdmissionChannel route="receiver-only" namedNets />,
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
    const [{ bindings }] = solver.getOutput().value
    const {
      routedTraceCuts,
      circuitJson: circuit,
      mappings,
      controls,
    } = bindings
    const modeling = { ...bindings.modeling, passiveComponents: [] }
    const error = {
      domain: "simulation",
      code: "channel_model",
      message: /RS has no selected deck model/,
    }
    assert.throws(
      () =>
        generalDeclarations({
          circuit,
          controls,
          modeling,
          mappings,
          routedTraceCuts,
        }),
      error,
    )
    assert.throws(
      () => generalDeclarations({ circuit, controls, modeling, mappings }),
      error,
    )
  },
)
