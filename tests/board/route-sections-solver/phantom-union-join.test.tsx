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
  "marks no pad at a union endpoint outside both physical endcaps",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace
            name="Lower"
            startX={-5}
            startLayer="inner1"
            endLayer="top"
            points={[
              { x: -4, y: 0, via: true, fromLayer: "inner1", toLayer: "top" },
            ]}
          />
          <SectionTrace
            name="Upper"
            startX={-5}
            startY={2}
            startLayer="inner1"
            endLayer="top"
            width={4.2}
            points={[
              { x: -4, y: 2, via: true, fromLayer: "inner1", toLayer: "top" },
            ]}
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
