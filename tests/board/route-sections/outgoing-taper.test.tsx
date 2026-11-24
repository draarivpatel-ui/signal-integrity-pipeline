import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing("rejects a taper on the outgoing wire point", async () => {
  const circuit = await renderSectionBoard({
    children: <SectionTrace name="Taper" hasStartTeardrop />,
  })
  const solver = new RouteSectionsSolver(getSectionInput({ circuit }))
  assert.throws(() => solver.solve(), /tapered routes/)
})
