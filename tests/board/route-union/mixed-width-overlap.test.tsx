import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("unions three same-net wires bridged by the widest wire", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Low" />
        <SectionTrace name="Middle" startY={1} />
        <SectionTrace name="Wide" startY={2} width={4.2} />
      </>
    ),
  })
  const { wires } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  assert.equal(wires.length, 1)
  assert.ok(Math.abs(wires[0].widthMm - 4.2) < 1e-7)
  assert.equal(wires[0].joins?.length, 4)
})
