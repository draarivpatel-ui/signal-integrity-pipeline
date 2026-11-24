import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rejects a required pad entirely within a via drill bore", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="Signal" />
        <SectionPin name="Bore" x={0} layer="bottom" />
        <via
          connectsTo="net.SIGNAL"
          pcbX={0}
          pcbY={0}
          fromLayer="top"
          toLayer="bottom"
          outerDiameter={1}
          holeDiameter={0.7}
        />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit, required: ["Bore"] }),
  )
  assert.throws(
    () => solver.solve(),
    /required endpoint .* has no physical wire or via contact/,
  )
})
