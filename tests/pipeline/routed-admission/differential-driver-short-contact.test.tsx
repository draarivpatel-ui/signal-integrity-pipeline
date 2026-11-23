import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test.failing(
  "names the physical driver contacts shorted between P and N",
  async () => {
    const circuitJson = await renderSignals({
      tree: <Differential routedTermination short="TX" />,
      expectedErrors: [
        "pcb_trace_missing_error",
        "pcb_port_not_connected_error",
      ],
    })
    const solver = new RoutedAdmissionSolver({
      circuitJson,
      ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
    })
    solver.solve()
    const [plan] = solver.getOutput().value
    const { bindings } = plan
    const [positive, negative] = bindings.mappings
    assert.ok(positive)
    assert.ok(negative)
    assert.throws(
      () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
      {
        domain: "simulation",
        code: "channel_short",
        message: `channel_short: BUS: negative contact ${negative.from} is shorted to ${positive.from}`,
      },
    )
  },
)
