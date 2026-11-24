import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("rejects a wire tail beyond the reference edge distance", async () => {
  const circuit = await renderSectionBoard({
    children: <SectionTrace name="Signal" />,
    reference: (
      <copperpour
        connectsTo="net.GND"
        layer="bottom"
        unbroken
        outline={[
          { x: -4, y: 0.2 },
          { x: 0.5, y: 0.2 },
          { x: 0.5, y: 1 },
          { x: -4, y: 1 },
        ]}
      />
    ),
  })
  assert.throws(
    () =>
      sectionRoutes({
        circuit,
        copperScope: getSectionInput({ circuit }).copperScope,
      }),
    /no actual reference pour/,
  )
})
