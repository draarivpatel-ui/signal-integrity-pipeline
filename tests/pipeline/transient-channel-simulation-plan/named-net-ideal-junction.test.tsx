import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { expectPlanPcbSnapshot } from "../../fixtures/plan-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a redundant named net preserves the ideal junction between two cuts", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg idealMiddleLeg namedNet />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  const [driverCut, receiverCut] = bindings.traceContacts
  const middleNode = node(driverCut.toSourcePortId)
  assert.ok(
    [
      node(receiverCut.fromSourcePortId),
      node(receiverCut.toSourcePortId),
    ].includes(middleNode),
  )
  assert.equal(new Set(plan.sections.requiredSourcePortIds.map(node)).size, 3)
  assert.equal(bindings.receiverPaths[1]?.sourceTraceIds?.length, 2)
  expectPlanPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 2,
    testPath: import.meta.path,
    caption: `DATA names both cuts; MID.A and JOIN.A share ${middleNode}`,
  })
})
