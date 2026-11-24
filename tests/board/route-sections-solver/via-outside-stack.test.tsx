import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "rejects a blind via with a layer outside the board stack",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace name="Signal" />
          <via
            connectsTo="net.SIGNAL"
            pcbX={0}
            pcbY={0}
            fromLayer="top"
            toLayer="inner3"
          />
        </>
      ),
    })
    const solver = new RouteSectionsSolver(getSectionInput({ circuit }))
    assert.throws(() => solver.solve(), /via .* unknown copper layer inner3/)
  },
)
