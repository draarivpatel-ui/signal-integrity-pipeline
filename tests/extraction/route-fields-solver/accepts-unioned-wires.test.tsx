import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

import { solveFieldsCopper } from "../../fixtures/fields-input"

test("accepts unioned wires", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="First" width={0.3} />
        <CopperTrace name="Signal" startY={0.3} width={0.3} net="net.SIGNAL" />
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
  solver.solve()
  assert(solver.getOutput().value)
})
