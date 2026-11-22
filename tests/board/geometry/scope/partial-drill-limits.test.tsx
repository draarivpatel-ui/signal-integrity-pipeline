import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
import { scopeFor, scopeNet } from "../../../fixtures/copper-scope-board"
import { BlindViaBoard } from "../../../fixtures/copper-scope-cases"
import { renderCoreSignals } from "../../../support/core-render"

test("an explicit top drill limit preserves the connected inner layer of a blind via", async () => {
  const circuit = await renderCoreSignals(<BlindViaBoard />)
  const net = scopeNet({ circuit, name: "NEIGHBOR" })
  const via = circuit.find(
    (record) => record.type === "pcb_via" && record.source_net_id === net,
  )
  assert(via?.type === "pcb_via")
  const limited = pcb_via.parse({ ...via, topmost_drill_layer: "top" })
  const records = circuit.map((record) => {
    if (record === via) return limited
    return record
  })
  assert(
    scopeFor({ circuit: records }).extractedPcbViaIds.includes(via.pcb_via_id),
  )
})
