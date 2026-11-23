import { test } from "bun:test"
import assert from "node:assert/strict"
import { Fragment } from "react"
import {
  renderScopeBoard,
  scopeFor,
  ScopeNeighborsBoard,
  scopeTrace,
} from "../../../fixtures/copper-scope-board"

test("vias on a retained adjacent route are retained", async () => {
  const circuit = await renderScopeBoard(
    <ScopeNeighborsBoard>
      {[-8, 8].map((pcbX) => (
        <Fragment key={pcbX}>
          <via
            pcbX={pcbX}
            pcbY={-0.5}
            fromLayer="top"
            toLayer="inner1"
            connectsTo=".ADJACENT > .A"
          />
        </Fragment>
      ))}
    </ScopeNeighborsBoard>,
  )
  const adjacent = scopeTrace({ circuit, name: "ADJACENT" })
  const vias = circuit.filter((record) => record.type === "pcb_via")
  const routedVias = vias.filter(
    (via) => via.pcb_trace_id === adjacent.pcb_trace_id,
  )
  const sourceLinkedVias = vias.filter(
    (via) =>
      via.source_trace_id !== undefined && via.pcb_trace_id === undefined,
  )
  assert.equal(routedVias.length, 2)
  assert.equal(sourceLinkedVias.length, 2)
  assert.deepEqual(
    new Set(scopeFor({ circuit }).extractedPcbViaIds),
    new Set([...routedVias, ...sourceLinkedVias].map((via) => via.pcb_via_id)),
  )
})
