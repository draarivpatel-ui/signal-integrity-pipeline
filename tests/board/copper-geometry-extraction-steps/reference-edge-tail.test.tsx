import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rejects a wire tail beyond the reference edge distance", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <SectionTrace name="Signal" />,
    reference: (
      <copperpour
        connectsTo="net.GND"
        layer="bottom"
        unbroken
        outline={[
          { x: -4, y: 0.2 },
          { x: 0.5, y: 0.2 },
          { x: 0.5, y: 1 },
          { x: -4, y: 1 },
        ]}
      />
    ),
  })
  assert.throws(
    () =>
      extractCopperGeometry({
        circuit,
        copperScope: getCopperExtractionInput({ circuit }).copperScope,
      }),
    /no actual reference pour/,
  )
})
