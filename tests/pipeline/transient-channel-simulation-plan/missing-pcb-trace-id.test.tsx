import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("rejects a PCB trace missing its own record ID", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  const trace = circuitJson.find((record) => record.type === "pcb_trace")
  assert.ok(trace)
  assert.ok(Reflect.deleteProperty(trace, "pcb_trace_id"))
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "circuit_schema",
    message: /pcb_trace_id/,
  })
})
