import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test(
  "marks no pad at a union endpoint outside both physical endcaps",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace
            name="Lower"
            startX={0}
          startY={-4}
          endY={0}
          points={[{ x: -4, y: 4 }]}
        />
        <SectionTrace
          name="Upper"
          startX={0}
          startY={4}
          endY={2}
          width={4.2}
          points={[{ x: -4, y: -2 }]}
        />
        <SectionPin name="Open" x={-4} y={-1.8} />
        </>
      ),
    })
    const solver = new RouteSectionsSolver(getSectionInput({ circuit }))
    solver.solve()

    const wire = solver
      .getOutput()
      .value.geometry.wires.find(
        ({ layer, joins }) => layer === "top" && joins?.length,
      )
    assert(wire)
    assert.equal(wire.startTouchesPort, false)
  },
)
