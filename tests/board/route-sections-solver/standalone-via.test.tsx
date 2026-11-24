import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("connects a required bottom pad through a scoped standalone via", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Signal" />
        <SectionPin name="Bottom" x={0} layer="bottom" />
        <via
          connectsTo="net.SIGNAL"
          pcbX={0}
          pcbY={0}
          fromLayer="top"
          toLayer="bottom"
          outerDiameter={0.6}
          holeDiameter={0.25}
        />
      </>
    ),
  })
  const [via] = cju(circuit).pcb_via.list()
  assert(via)
  const input = getSectionInput({ circuit, required: ["Bottom"] })
  assert(input.copperScope.extractedPcbViaIds.includes(via.pcb_via_id))
  const solver = new RouteSectionsSolver(input)
  assert.doesNotThrow(() => solver.solve())
})
