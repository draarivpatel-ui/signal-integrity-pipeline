import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("rejects touching nets", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="First" width={0.3} />
        <CopperTrace name="Other" startY={0.3} width={0.3} net="net.OTHER" />
      </>
    ),
  })
  const geometry = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  const solver = new RouteFieldsSolver({
    geometry,
    materials: { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 },
    artifactPrefix: "test",
  })
  assert.throws(
    () => solver.solve(),
    {
      code: "cross_section_geometry",
      message: /Conductor rectangles overlap or touch/,
    },
    "touching different nets remain an explicit failure",
  )
})
