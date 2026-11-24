import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { generalDeclarations } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a cut-only contact needs a passive selected for the deck", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionDaisyChain routeFinalLeg placedLoad="mapped" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  assert.equal(bindings.routedTraceCuts.length, 3)
  const load = cju([...bindings.circuitJson]).source_component.getWhere({
    name: "LOAD",
  })
  assert.ok(load)
  assert.ok(
    !bindings.modeling.passiveComponents?.some(
      ({ sourceComponentId }) => sourceComponentId === load.source_component_id,
    ),
  )
  assert.throws(
    () => generalDeclarations({ ...bindings, circuit: bindings.circuitJson }),
    { domain: "simulation", code: "channel_model", message: /LOAD/ },
  )
})
