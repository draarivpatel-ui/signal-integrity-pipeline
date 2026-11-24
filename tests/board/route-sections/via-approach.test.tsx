import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "keeps the wire approaching a via on the entry layer",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <SectionTrace
          name="Via"
          endLayer="inner1"
          points={[
            { x: 4, y: 0, via: true, fromLayer: "top", toLayer: "inner1" },
          ]}
        />
      ),
    })
    const solver = new RouteSectionsSolver(getSectionInput({ circuit }))
    solver.solve()
    assert.deepEqual(
      solver
        .getOutput()
        .value.geometry.wires.map(({ layer, a, b }) => [layer, a, b]),
      [
        ["top", [-4, 0], [0, 0]],
        ["inner1", [0, 0], [4, 0]],
      ],
    )
  },
)
