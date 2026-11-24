import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("keeps the arc of a rounded antipad", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Crossing" startY={0.3} />
        <cutout shape="circle" radius={0.5} />
      </>
    ),
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const [hole] = pour.brep_shape.inner_rings
  assert(hole?.vertices.length)
  // Core tessellates the circular cutout. Encode the same radius as two arcs.
  const radiusMm = Math.max(...hole.vertices.map(({ y }) => Math.abs(y)))
  assert(radiusMm > 0.3)
  const board = circuit.map((record) => {
    if (record !== pour) return record
    return {
      ...pour,
      brep_shape: {
        ...pour.brep_shape,
        inner_rings: [
          {
            vertices: [
              { x: -radiusMm, y: 0, bulge: 1 },
              { x: radiusMm, y: 0, bulge: 1 },
            ],
          },
        ],
      },
    }
  })
  const { sections } = sectionRoutes({
    circuit: board,
    copperScope: getSectionInput({ circuit: board }).copperScope,
  })
  assert.equal(sections.length, 3)
  assert.ok(sections[1].references[0].lateralGapMm)
  assert.equal("distance" in sections[1].references[0], false)
})
