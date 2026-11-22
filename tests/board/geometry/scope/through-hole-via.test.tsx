import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
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
    assert.equal(
      scopeFor({ circuit }).extractedPcbTraceIds.includes(neighbor),
      !allowBlindAndBuriedVias,
    )
    // Core omits the per-via flag. Add it to test an explicit through-hole on a blind-via board.
    const throughHole = pcb_via.parse({ ...via, through_hole: true })
    const records = circuit.map((record) => {
      if (record === via) return throughHole
      return record
    })
    const scope = scopeFor({ circuit: records })
    assert(scope.extractedPcbTraceIds.includes(neighbor))
    assert.deepEqual(scope.extractedPcbViaIds, [via.pcb_via_id])
  }
})
