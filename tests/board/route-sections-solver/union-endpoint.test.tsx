import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing("marks port contacts on a shifted union centerline", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Low" />
        <SectionTrace name="High" startY={0.3} width={0.4} />
      </>
    ),
  })
  const solver = new RouteSectionsSolver(
    getSectionInput({ circuit, required: ["LowStart", "HighEnd"] }),
  )
  solver.solve()
  const { wires } = solver.getOutput().value.geometry
  assert.equal(wires.length, 1)
  assert.equal(wires[0].aPort, true)
  assert.equal(wires[0].bPort, true)
})
