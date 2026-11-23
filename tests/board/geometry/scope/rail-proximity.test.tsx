import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeFor,
  scopeNet,
  scopeTrace,
} from "../../../fixtures/copper-scope-board"
import { RailProximityBoard } from "../../../fixtures/copper-scope-cases"
import { renderCoreSignals } from "../../../support/core-render"

test("supply and reference traces stay local and only reference vias are kept board-wide", async () => {
  const circuit = await renderCoreSignals(<RailProximityBoard />)
  const ground = scopeNet({ circuit, name: "GND" })
  const supply = scopeNet({ circuit, name: "VDD" })
  const result = scopeFor({ circuit, referenceNet: "GND", railNets: ["VDD"] })
  const expectedRails = ["GROUND", "SUPPLY"].map(
    (name) => scopeTrace({ circuit, name }).pcb_trace_id,
  )
  assert.deepEqual(
    new Set(result.nearbyRailPcbTraceIds),
    new Set(expectedRails),
  )
  assert.deepEqual(
    new Set(result.extractedPcbTraceIds),
    new Set([...result.channelPcbTraceIds, ...expectedRails]),
  )
  assert(!result.extractedSourceIds.includes(ground))
  assert(!result.extractedSourceIds.includes(supply))
  const expectedVias = circuit
    .filter((record) => record.type === "pcb_via")
    .filter((via) => via.source_net_id === ground || via.y === 0.7)
  assert.equal(expectedVias.length, 2)
  assert.deepEqual(
    result.extractedPcbViaIds,
    expectedVias.map((via) => via.pcb_via_id),
  )
})
