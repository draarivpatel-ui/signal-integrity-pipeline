import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "names both contacts and every routed trace in a bypassed receiver path",
  async () => {
    const circuitJson = await renderSignals({
      tree: <AdmissionChannel route="series" short="channel" />,
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
    const [mapping] = bindings.mappings
    assert.equal(mapping.sourceTraceIds?.length, 2)
    assert.throws(
      () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
      {
        domain: "simulation",
        code: "channel_short",
        message: `channel_short: DATA: endpoints ${mapping.from} and ${mapping.to} share an ideal node across routed path ${mapping.sourceTraceIds?.join(", ")}`,
      },
    )
  },
)
