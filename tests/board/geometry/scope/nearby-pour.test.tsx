import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_copper_pour } from "circuit-json"
import { scopeFor } from "../../../fixtures/copper-scope-board"
import { NearbyPourBoard } from "../../../fixtures/copper-scope-cases"
import { renderCoreSignals } from "../../../support/core-render"

test("a nearby non-reference pour retains its distant routed net", async () => {
  const circuit = await renderCoreSignals(<NearbyPourBoard />)
  const source = circuit.find(
    (record) =>
      record.type === "source_trace" && record.name === "DISTANT_route",
  )
  assert(source?.type === "source_trace")
  const route = circuit.find(
    (record) =>
      record.type === "pcb_trace" &&
      record.source_trace_id === source.source_trace_id,
  )
  assert(route?.type === "pcb_trace")
  const result = scopeFor({ circuit })
  assert(result.extractedPcbTraceIds.includes(route.pcb_trace_id))

  // Move the rendered pours two stack indices below the channel.
  const deeper = circuit.map((record) => {
    if (record.type !== "pcb_copper_pour") return record
    return pcb_copper_pour.parse({ ...record, layer: "inner2" })
  })
  assert(
    !scopeFor({ circuit: deeper }).extractedPcbTraceIds.includes(
      route.pcb_trace_id,
    ),
  )
})
