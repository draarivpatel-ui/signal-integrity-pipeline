import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { circuitJsonDb } from "../../../src/board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a cut cycle diagnostic excludes the attached load tail", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <AdmissionDaisyChain routeFinalLeg bypassFinalLeg placedLoad="mapped" />
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const db = circuitJsonDb(circuitJson)
  const load = db.source_component.getWhere({ name: "LOAD" })
  assert.ok(load)
  const port = db.source_port.getWhere({
    source_component_id: load.source_component_id,
    name: "pin1",
  })
  assert.ok(port)
  const tail = bindings.routedTraceCuts.find(
    ({ fromSourcePortId, toSourcePortId }) =>
      fromSourcePortId === port.source_port_id ||
      toSourcePortId === port.source_port_id,
  )
  assert.ok(tail)
  const cycle = bindings.routedTraceCuts.filter((cut) => cut !== tail)
  assert.equal(cycle.length, 2)
  assert.throws(
    () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, "channel_short")
      for (const cut of cycle) {
        assert.ok(error.message.includes(cut.sourceTraceId))
        assert.ok(error.message.includes(cut.fromSourcePortId))
        assert.ok(error.message.includes(cut.toSourcePortId))
      }
      assert.ok(!error.message.includes(tail.sourceTraceId))
      return true
    },
  )
})
