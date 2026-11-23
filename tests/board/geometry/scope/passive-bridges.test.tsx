import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  renderScopeBoard,
  scopeFor,
  scopeNet,
  scopeTrace,
} from "../../../fixtures/copper-scope-board"
import { PassiveBridgesBoard } from "../../../fixtures/copper-scope-cases"

test("passive bridges extend a nearby signal but stop at supply and reference nets", async () => {
  const circuit = await renderScopeBoard(<PassiveBridgesBoard />)
  const result = scopeFor({ circuit, referenceNet: "GND", railNets: ["VDD"] })
  assert.deepEqual(
    result.extractedPcbTraceIds,
    ["SELECTED", "NEAR", "FAR", "LAST"].map(
      (name) => scopeTrace({ circuit, name }).pcb_trace_id,
    ),
  )
  for (const name of ["GND", "VDD"])
    assert(!result.extractedSourceIds.includes(scopeNet({ circuit, name })))
})
