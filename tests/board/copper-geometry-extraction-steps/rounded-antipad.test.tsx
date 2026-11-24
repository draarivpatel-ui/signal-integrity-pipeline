import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { extractCopperGeometry } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("sections the trace at a rounded antipad", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="Crossing" startY={0.3} />
        <cutout shape="circle" radius={0.5} />
      </>
    ),
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const [hole] = pour.brep_shape.inner_rings
  assert(hole?.vertices.length)
  const { sections } = extractCopperGeometry({
    circuit,
    copperScope: getCopperExtractionInput({ circuit }).copperScope,
  })
  assert.equal(sections.length, 3)
  assert.ok(sections[1].references[0].lateralGapMm)
  assert.equal("distance" in sections[1].references[0], false)
})
