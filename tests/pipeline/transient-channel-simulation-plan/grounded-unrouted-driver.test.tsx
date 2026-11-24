import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("rejects a grounded driver beyond the first physical cut", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="receiver-only" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const [mapping] = bindings.mappings
  assert.equal(bindings.routedTraceCuts.length, 1)
  assert.ok(mapping)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
        modeling: {
          ...bindings.modeling,
          channelReference: { sourcePortId: mapping.from },
        },
      }),
    { domain: "simulation", code: "channel_short", message: /ground/ },
  )
})
