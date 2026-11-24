import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "accepts a required pad overlapping the middle of a wire",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace name="Trace" width={0.4} />
          <SectionPin name="Offset" x={0} y={0.3} />
        </>
      ),
    })
    const solver = new RouteSectionsSolver(
      getSectionInput({ circuit, required: ["Offset"] }),
    )
    assert.doesNotThrow(() => solver.solve())
  },
)
