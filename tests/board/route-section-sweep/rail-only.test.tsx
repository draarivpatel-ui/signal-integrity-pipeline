import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("keeps nearby rail copper without emitting rail-only sections", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Signal" startX={-1} endX={1} />
        <SectionTrace name="Rail" startY={0.7} net="net.OTHER" />
      </>
    ),
  })
  const { copperScope } = getSectionInput({ circuit, railNetName: "OTHER" })
  assert.equal(copperScope.nearbyRailPcbTraceIds.length, 1)
  const { wires, sections } = sectionRoutes({ circuit, copperScope })
  assert.equal(wires.length, 2)
  assert.deepEqual(
    sections.map(({ startMm, endMm, wires }) => [startMm, endMm, wires.length]),
    [[-1, 1, 2]],
  )
})
