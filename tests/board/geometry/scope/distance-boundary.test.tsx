import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, scopeTrace } from "../../../fixtures/copper-scope-board"
import { DistanceBoundaryBoard } from "../../../fixtures/copper-scope-cases"
import { renderCoreSignals } from "../../../support/core-render"

test("the inclusive lateral cap measures the Euclidean gap between copper bounds", async () => {
  const circuit = await renderCoreSignals(<DistanceBoundaryBoard />)
  const result = scopeFor({ circuit })
  assert.deepEqual(
    result.extractedPcbTraceIds,
    ["SELECTED", "ON_BOUNDARY", "DIAGONAL_INSIDE"].map(
      (name) => scopeTrace({ circuit, name }).pcb_trace_id,
    ),
  )
})
