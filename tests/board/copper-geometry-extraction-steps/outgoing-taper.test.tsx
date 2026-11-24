import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rejects a taper on the outgoing wire point", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <SectionTrace name="Taper" hasStartTeardrop />,
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit }),
  )
  assert.throws(() => solver.solve(), /tapered routes/)
})
