import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a routed receiver segment survives an ideal driver segment", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="receiver-only" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  const [traceId] = sections.copperScope.channelPcbTraceIds
  const trace = cju(circuitJson).pcb_trace.get(traceId)
  assert.ok(trace?.type === "pcb_trace" && trace.source_trace_id)
  assert.equal(sections.copperScope.channelPcbTraceIds.length, 1)
  assert.deepEqual(
    bindings.mappings.map((mapping) => mapping.sourceTraceId),
    [trace.source_trace_id],
  )
})
