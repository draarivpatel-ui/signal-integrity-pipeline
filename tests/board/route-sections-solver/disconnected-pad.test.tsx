import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("rejects a placed required pad with disconnected copper", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Trace" />
        <SectionPin name="Open" x={0} y={3} />
      </>
    ),
  })
  const solver = new RouteSectionsSolver(
    getSectionInput({ circuit, required: ["Open"] }),
  )
  assert.throws(
    () => solver.solve(),
    /required endpoint .* has no physical wire or via contact/,
  )
  assert.equal(solver.failed, true)
  assert.throws(() => solver.getOutput(), /incomplete/)
})
