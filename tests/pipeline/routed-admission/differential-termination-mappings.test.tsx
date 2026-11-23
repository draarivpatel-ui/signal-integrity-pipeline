import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("keeps four physical cuts and maps only the two declared differential receivers", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential routedTermination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.deepEqual(
    bindings.routedTraceCuts.map((cut) => cut.sourceTraceId),
    ["source_trace_6", "source_trace_8", "source_trace_9", "source_trace_7"],
  )
  const nodes = circuitNodes({ ...bindings, circuit: bindings.circuitJson })
  assert.deepEqual(
    bindings.mappings.map(({ sourceTraceId, from, to }) => [
      sourceTraceId,
      nodes.node(from),
      nodes.node(to),
    ]),
    [
      ["source_trace_6", "n1", "n6"],
      ["source_trace_7", "n2", "n7"],
    ],
  )
})
