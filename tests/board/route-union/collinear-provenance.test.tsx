import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("keeps both contributors to a collinear same-net union", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Long" />
        <SectionTrace name="Short" startX={-2} endX={2} />
      </>
    ),
  })
  const { wires } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  const mergedWire = wires.find(
    ({ startPoint, endPoint }) => startPoint[0] === -2 && endPoint[0] === 2,
  )
  assert(mergedWire)
  assert.deepEqual(
    mergedWire.contributingPcbTraceIds,
    cju(circuit)
      .pcb_trace.list()
      .map(({ pcb_trace_id }) => pcb_trace_id),
  )
  assert.equal(mergedWire.joins?.length, 0)
})
