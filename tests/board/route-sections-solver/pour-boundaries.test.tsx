import "graphics-debug/matcher"
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("draws the three reference intervals across a copper cutout", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Crossing" startX={-6} endX={6} width={0.35} />
        <cutout
          shape="polygon"
          points={[
            { x: -1.35, y: 0 },
            { x: 0, y: -1 },
            { x: 1.35, y: 0 },
            { x: 0, y: 1 },
          ]}
        />
      </>
    ),
  })
  const solver = new RouteSectionsSolver(
    getSectionInput({ circuit, required: ["CrossingStart", "CrossingEnd"] }),
  )
  solver.solve()
  const { sections } = solver.getOutput().value.geometry
  assert.equal(sections.length, 3)
  assert(sections[1].references[0].lateralGapMm)
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "#ffffff",
  })
})
