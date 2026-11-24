import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("does not mark an unrelated pad as a signal wire endpoint", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace
          name="Signal"
          width={0.3}
          endY={-2}
          points={[{ x: 4, y: 0 }]}
        />
        <SectionPin name="Foreign" x={0} net="net.OTHER" />
      </>
    ),
  })
  const input = getSectionInput({ circuit })
  const solver = new RouteSectionsSolver(input)
  solver.solve()
  const { geometry } = solver.getOutput().value
  const wire = geometry.wires.find(
    ({ endPoint }) => endPoint[0] === 0 && endPoint[1] === 0,
  )
  assert(wire)
  assert.equal(wire.endTouchesPort, false)
})
