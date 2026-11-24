import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a collapsed receiver reports cycle evidence without fabricating a lane path", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="parallel-passives" short="channel" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const [cut] = bindings.routedTraceCuts
  assert.equal(bindings.mappings.length, 0)
  assert.throws(
    () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
    {
      code: "channel_short",
      message: new RegExp(
        `${cut.sourceTraceId}.*${cut.fromSourcePortId}.*${cut.toSourcePortId}`,
      ),
    },
  )
})
