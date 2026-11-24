import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { expectPlanPcbSnapshot } from "../../fixtures/plan-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a one-trace receiver mapping preserves both physical cut contacts", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="receiver-only" namedNets />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const [cut] = bindings.routedTraceCuts
  const [mapping] = bindings.mappings
  assert.equal(mapping.sourceTraceId, cut.sourceTraceId)
  assert.notEqual(mapping.from, cut.fromSourcePortId)
  expectPlanPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 1,
    testPath: import.meta.path,
    caption: "Only the receiver segment is routed",
  })
  const { node } = circuitNodes({
    circuit: bindings.circuitJson,
    mappings: bindings.mappings,
    modeling: bindings.modeling,
  })
  assert.notEqual(node(cut.fromSourcePortId), node(cut.toSourcePortId))
})
