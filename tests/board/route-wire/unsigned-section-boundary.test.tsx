import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import { roundRouteCoordinate } from "../../../src/board/route-wire"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("rounds a slightly negative boundary to unsigned zero", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <SectionTrace
        name="Signal"
        startX={-1e-6}
        startY={1}
        endX={4.02}
        endY={1.000004}
      />
    ),
  })
  const { wires } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  assert.equal(roundRouteCoordinate(wires[0].longitudinalMinMm), 0)
})
