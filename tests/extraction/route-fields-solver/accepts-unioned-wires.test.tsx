import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("accepts unioned wires", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="First" width={0.3} />
        <SectionTrace name="Signal" startY={0.3} width={0.3} net="net.SIGNAL" />
      </>
    ),
  })
  const geometry = extractCopperGeometry({
    circuit,
    copperScope: getCopperExtractionInput({ circuit }).copperScope,
  })
  const solver = new RouteFieldsSolver({
    geometry,
    materials: { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 },
    artifactPrefix: "test",
  })
  solver.solve()
  assert(solver.getOutput().value)
})
