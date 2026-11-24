import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("marks port contacts on a shifted union centerline", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="Low" />
        <SectionTrace name="High" startY={0.3} width={0.4} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit, required: ["LowStart", "HighEnd"] }),
  )
  solver.solve()
  const { wires } = solver.getOutput().value.geometry
  assert.equal(wires.length, 1)
  assert.equal(wires[0].startTouchesPort, true)
  assert.equal(wires[0].endTouchesPort, true)
})
