import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("touching wires on separate nets remain separate conductors", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Signal" width={0.3} />
        <SectionTrace name="Other" startY={0.3} width={0.3} net="net.OTHER" />
      </>
    ),
  })
  const db = cju(circuit)
  assert(db.pcb_trace_error.list().length > 0)
  assert.equal(db.pcb_trace.list().length, 2)
  const { wires } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    wires.map(({ pcbTraceId, widthMm }) => [pcbTraceId, widthMm]),
    db.pcb_trace.list().map((trace) => [trace.pcb_trace_id, 0.3]),
  )
  assert(wires.every((wire) => !wire.joins?.length))
})
