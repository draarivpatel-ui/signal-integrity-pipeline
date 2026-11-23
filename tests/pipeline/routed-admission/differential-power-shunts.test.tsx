import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionShunts } from "../../fixtures/admission-shunts"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("pull-ups on both differential legs keep their signal nodes distinct", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential partialSeriesPair allowUnroutedTraces>
        <AdmissionShunts pin="A" rail="VCC" />
        <AdmissionShunts pin="B" rail="VCC" />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const { node } = circuitNodes({
    ...bindings,
    circuit: bindings.circuitJson,
  })
  const [positive, negative] = bindings.mappings
  assert.equal(positive.sourceTraceIds?.length, 2)
  assert.equal(negative.sourceTraceIds?.length, 2)
  assert.notEqual(node(positive.from), node(negative.from))
  assert.notEqual(node(positive.to), node(negative.to))
})
