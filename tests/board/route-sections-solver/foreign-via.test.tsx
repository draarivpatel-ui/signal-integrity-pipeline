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
  "rejects a required pad that only reaches the wire through a ground via",
  async () => {
    const circuit = await renderSectionBoard({
      reference: <copperpour connectsTo="net.GND" layer="inner1" unbroken />,
      children: (
        <>
          <SectionTrace name="Signal" />
          <SectionPin name="Bottom" x={0} layer="bottom" />
          <via
            connectsTo="net.GND"
            pcbX={0}
            pcbY={0}
            outerDiameter={0.6}
            holeDiameter={0.25}
          />
        </>
      ),
    })
    const solver = new RouteSectionsSolver(
      getSectionInput({ circuit, required: ["Bottom"] }),
    )
    assert.throws(() => solver.solve(), /no physical wire or via contact/)
  },
)
