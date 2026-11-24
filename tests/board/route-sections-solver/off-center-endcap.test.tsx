import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "marks an endcap overlapping an off-center same-net pad",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace
            name="Signal"
            width={0.5}
            endY={-2}
            points={[{ x: 4, y: 0 }]}
          />
          <SectionPin name="Offset" x={0} y={0.4} />
        </>
      ),
    })
    const input = getSectionInput({ circuit, required: ["Offset"] })
    const solver = new RouteSectionsSolver(input)
    solver.solve()
    const { geometry } = solver.getOutput().value
    const wire = geometry.wires.find(
      ({ endPoint }) => endPoint[0] === 0 && endPoint[1] === 0,
    )
    assert(wire)
    assert.equal(wire.endTouchesPort, true)
  },
)
