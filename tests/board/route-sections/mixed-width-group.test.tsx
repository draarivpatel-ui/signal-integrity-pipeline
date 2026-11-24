import { test } from "bun:test"
import assert from "node:assert/strict"
import { segmentRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "groups wires by the furthest edge of the preceding group",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace name="Wide" width={4} />
          <SectionTrace name="Middle" startY={0.5} net="net.OTHER" />
          <SectionTrace name="High" startY={2.2} net="net.OTHER" />
        </>
      ),
    })
    const { slices } = segmentRoutes({
      circuit,
      scope: getSectionInput({ circuit }).copperScope,
    })
    assert.deepEqual(
      slices.map(({ wires }) => wires.length),
      [3],
    )
  },
)
