import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

import { solveFieldsCopper } from "../../fixtures/fields-input"

test("rejects touching nets", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="First" width={0.3} />
        <CopperTrace name="Other" startY={0.3} width={0.3} net="net.OTHER" />
      </>
    ),
  })
  const copperGeometry = solveFieldsCopper(
    getCopperGeometryExtractionInput({ circuit }),
  )
  const solver = new RouteFieldsSolver({
    copperGeometry,
    materials: {
      maskThicknessMm: 0,
      maskRelativePermittivity: 1,
      maskLossTangent: 0,
      laminateLossTangent: 0,
    },
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
