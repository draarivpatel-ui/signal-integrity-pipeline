import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, scopeTrace } from "../../../fixtures/copper-scope-board"
import { NearbyPourBoard } from "../../../fixtures/copper-scope-cases"
import { renderCoreSignals } from "../../../support/core-render"

test("a nearby non-reference pour retains its distant routed net", async () => {
  for (const pourLayer of ["top", "inner2"] as const) {
    const circuit = await renderCoreSignals(
      <NearbyPourBoard pourLayer={pourLayer} />,
    )
    const pours = circuit.filter((record) => record.type === "pcb_copper_pour")
    assert.deepEqual(
      pours.map((pour) => pour.layer),
      [pourLayer, pourLayer],
    )
    const route = scopeTrace({ circuit, name: "DISTANT" })
    assert.equal(
      scopeFor({ circuit }).extractedPcbTraceIds.includes(route.pcb_trace_id),
      pourLayer === "top",
    )
  }
})
