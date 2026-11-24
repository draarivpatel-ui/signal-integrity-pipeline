import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { segmentRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "cuts a section at both antipad vertices on the wire",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace name="Crossing" />
          <cutout
            shape="polygon"
            points={[
              { x: -0.5, y: 0 },
              { x: 0, y: -0.5 },
              { x: 0.5, y: 0 },
              { x: 0, y: 0.5 },
            ]}
          />
        </>
      ),
    })
    const [pour] = cju(circuit).pcb_copper_pour.list()
    assert(pour?.shape === "brep")
    const [hole] = pour.brep_shape.inner_rings
    assert(hole?.vertices.length)
    const leftMm = Math.min(...hole.vertices.map(({ x }) => x))
    const rightMm = Math.max(...hole.vertices.map(({ x }) => x))
    const { slices } = segmentRoutes({
      circuit,
      scope: getSectionInput({ circuit }).copperScope,
    })
    assert.deepEqual(
      slices.map(({ start, end }) => [start, end]),
      [
        [-4, leftMm],
        [leftMm, rightMm],
        [rightMm, 4],
      ],
    )
    assert.equal(slices[0].references[0].lateralGapMm, undefined)
    assert.ok(slices[1].references[0].lateralGapMm)
    assert.equal(slices[2].references[0].lateralGapMm, undefined)
  },
)
