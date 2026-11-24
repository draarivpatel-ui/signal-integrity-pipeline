import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("groups near-vertical wires whose rounded directions coincide", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Straight" startX={0} endX={0} startY={-3} endY={3} />
        <CopperTrace
          name="Skew"
          startX={0.3}
          endX={0.3 - 1e-7}
          startY={-3}
          endY={3}
          net="net.OTHER"
        />
      </>
    ),
  })
  const { sections } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    sections.map(({ wires }) => wires.length),
    [2],
  )
})
