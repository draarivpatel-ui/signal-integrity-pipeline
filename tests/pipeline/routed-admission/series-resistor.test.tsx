import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("series resistor keeps both routed segments electrically distinct", async () => {
  const circuitJson = await renderCoreSignals(
    <AdmissionChannel route="series" />,
  )
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings, sections } = plan
  assert.equal(sections.requiredSourcePortIds.length, 4)
  assert.equal(bindings.mappings.length, 1)
  const [mapping] = bindings.mappings
  const traces = cju(circuitJson).source_trace.list()
  const driverTrace = traces.find((trace) =>
    trace.connected_source_port_ids.includes(mapping.from),
  )
  const receiverTrace = traces.find((trace) =>
    trace.connected_source_port_ids.includes(mapping.to),
  )
  assert.ok(driverTrace && receiverTrace)
  const { node } = circuitNodes({
    ...bindings,
    circuit: bindings.circuitJson,
  })
  for (const trace of [driverTrace, receiverTrace]) {
    const [from, to] = trace.connected_source_port_ids
    assert.notEqual(node(from), node(to), trace.source_trace_id)
  }
  assert.deepEqual(mapping.sourceTraceIds, [
    driverTrace.source_trace_id,
    receiverTrace.source_trace_id,
  ])
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 2,
    testPath: import.meta.path,
  })
})
