import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, scopeTrace } from "../../../fixtures/copper-scope-board"
import { ThroughHoleViaBoard } from "../../../fixtures/copper-scope-cases"
import { renderCoreSignals } from "../../../support/core-render"

test("through-hole barrels reach layers beyond their connected copper", async () => {
  for (const allowBlindAndBuriedVias of [false, true]) {
    const circuit = await renderCoreSignals(
      <ThroughHoleViaBoard allowBlindAndBuriedVias={allowBlindAndBuriedVias} />,
    )
    const via = circuit.find((record) => record.type === "pcb_via")
    assert(via)
    assert.deepEqual(via.layers, ["top", "inner1"])
    const neighbor = scopeTrace({ circuit, name: "NEIGHBOR" }).pcb_trace_id
    const scope = scopeFor({ circuit })
    assert.equal(
      scope.extractedPcbTraceIds.includes(neighbor),
      !allowBlindAndBuriedVias,
    )
    const expectedVias = []
    if (!allowBlindAndBuriedVias) expectedVias.push(via.pcb_via_id)
    assert.deepEqual(scope.extractedPcbViaIds, expectedVias)
  }
})
