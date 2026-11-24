import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "publishes the immutable circuit and copper scope supplied by planning",
  async () => {
    const circuit = await renderSectionBoard({
      children: <SectionTrace name="Signal" />,
    })
    const input = getSectionInput({ circuit })
    const solver = new RouteSectionsSolver(input)
    solver.solve()
    const produced = solver.getOutput()
    assert.equal(produced.value.circuitJson, input.circuitJson)
    assert.equal(produced.value.scope, input.copperScope)
    assert(Object.isFrozen(produced))
    assert(Object.isFrozen(produced.artifacts))
  },
)
