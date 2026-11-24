import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("touching same-net wires form one conductor", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Low" width={0.3} />
        <SectionTrace name="High" startY={0.3} width={0.3} />
      </>
    ),
  })
  const { wires } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  assert.equal(wires.length, 1)
  assert.ok(Math.abs(wires[0].widthMm - 0.6) < 1e-7)
  assert.equal(wires[0].joins?.length, 4)
})
