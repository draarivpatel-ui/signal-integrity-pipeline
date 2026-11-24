import { test } from "bun:test"
import assert from "node:assert/strict"
import { segmentRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "groups near-vertical wires whose rounded directions coincide",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace
            name="Straight"
            startX={0}
            endX={0}
            startY={-3}
            endY={3}
          />
          <SectionTrace
            name="Skew"
            startX={0.3}
            endX={0.3 - 3e-9}
            startY={-3}
            endY={3}
            net="net.OTHER"
          />
        </>
      ),
    })
    const { slices } = segmentRoutes({
      circuit,
      scope: getSectionInput({ circuit }).copperScope,
    })
    assert.deepEqual(
      slices.map(({ wires }) => wires.length),
      [2],
    )
  },
)
