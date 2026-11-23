import { test } from "bun:test"
import assert from "node:assert/strict"
import { circuitJsonDb } from "../../../src/board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("an interior short cannot divert the partial positive leg through the far termination", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential partialSeriesPair directNegative allowUnroutedTraces>
        <trace from=".RA1 > .pin2" to=".TX > .B" />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const resistor = circuitJsonDb(circuitJson).source_component.getWhere({
    name: "RA1",
  })
  assert.ok(resistor)
  const contact = circuitJsonDb(circuitJson).source_port.getWhere({
    source_component_id: resistor.source_component_id,
    name: "pin2",
  })
  assert.ok(contact)
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const [positive, negative] = bindings.mappings
  assert.equal(positive.sourceTraceIds?.length, 2)
  assert.ok(!positive.sourceTraceIds?.includes(negative.sourceTraceId))
  assert.throws(
    () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
    { code: "channel_short", message: new RegExp(contact.source_port_id) },
  )
})
