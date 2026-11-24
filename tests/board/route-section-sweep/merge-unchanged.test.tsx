import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("coalesces intervals split by an unused reference boundary", async () => {
  const circuit = await renderSectionBoard({
    children: <SectionTrace name="Signal" />,
    reference: (
      <>
        <copperpour connectsTo="net.GND" layer="inner1" unbroken />
        <copperpour
          connectsTo="net.GND"
          layer="bottom"
          unbroken
          outline={[
            { x: -2, y: -1 },
            { x: 2, y: -1 },
            { x: 2, y: 1 },
            { x: -2, y: 1 },
          ]}
        />
      </>
    ),
  })
  const { sections, pours } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  assert.equal(pours.length, 2)
  assert.deepEqual(
    sections.map(({ startMm, endMm, references }) => [
      startMm,
      endMm,
      references[0].layer,
    ]),
    [[-4, 4, "inner1"]],
  )
})
