import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("stage boards share a deeply frozen Circuit JSON snapshot", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const board = plan.sections.circuitJson
  assert.equal(board, plan.bindings.circuitJson)
  assert.ok(Object.isFrozen(board))
  const trace = board.find((record) => record.type === "pcb_trace")
  assert.ok(trace?.route.length)
  assert.ok(Object.isFrozen(trace))
  assert.ok(Object.isFrozen(trace.route))
  assert.ok(Object.isFrozen(trace.route[0]))
})
