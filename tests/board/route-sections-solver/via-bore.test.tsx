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
  "rejects a required pad entirely within a via drill bore",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace name="Signal" />
          <SectionPin name="Bore" x={0} layer="bottom" />
          <via
            connectsTo="net.SIGNAL"
            pcbX={0}
            pcbY={0}
            fromLayer="top"
            toLayer="bottom"
            outerDiameter={1}
            holeDiameter={0.7}
          />
        </>
      ),
    })
    const solver = new RouteSectionsSolver(
      getSectionInput({ circuit, required: ["Bore"] }),
    )
    assert.throws(
      () => solver.solve(),
      /required endpoint .* has no physical wire or via contact/,
    )
  },
)
