import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import { roundWireCoordinate } from "../../../src/board/copper-geometry-wire"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rounds a slightly negative boundary to unsigned zero", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <SectionTrace
        name="Signal"
        startX={-1e-6}
        startY={1}
        endX={4.02}
        endY={1.000004}
      />
    ),
  })
  const { wires } = extractCopperGeometry({
    circuit,
    copperScope: getCopperExtractionInput({ circuit }).copperScope,
  })
  assert.equal(roundWireCoordinate(wires[0].longitudinalMinMm), 0)
})
