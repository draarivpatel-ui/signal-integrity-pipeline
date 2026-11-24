import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("groups wires by the furthest edge of the preceding group", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="Wide" width={4} />
        <SectionTrace name="Middle" startY={0.5} net="net.OTHER" />
        <SectionTrace name="High" startY={2.2} net="net.OTHER" />
      </>
    ),
  })
  const { sections } = extractCopperGeometry({
    circuit,
    copperScope: getCopperExtractionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    sections.map(({ wires }) => wires.length),
    [3],
  )
})
