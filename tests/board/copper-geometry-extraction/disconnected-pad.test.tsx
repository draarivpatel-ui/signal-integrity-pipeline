import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rejects a placed required pad with disconnected copper", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="Trace" />
        <SectionPin name="Open" x={0} y={3} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit, required: ["Open"] }),
  )
  assert.throws(
    () => solver.solve(),
    /required endpoint .* has no physical wire or via contact/,
  )
  assert.equal(solver.failed, true)
  assert.throws(() => solver.getOutput(), /incomplete/)
})
