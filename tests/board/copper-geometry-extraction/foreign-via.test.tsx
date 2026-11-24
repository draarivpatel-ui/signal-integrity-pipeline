import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rejects a required pad that only reaches the wire through a ground via", async () => {
  const circuit = await renderCopperGeometryBoard({
    reference: <copperpour connectsTo="net.GND" layer="inner1" unbroken />,
    children: (
      <>
        <SectionTrace name="Signal" />
        <SectionPin name="Bottom" x={0} layer="bottom" />
        <via
          connectsTo="net.GND"
          pcbX={0}
          pcbY={0}
          outerDiameter={0.6}
          holeDiameter={0.25}
        />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit, required: ["Bottom"] }),
  )
  assert.throws(() => solver.solve(), /no physical wire or via contact/)
})
