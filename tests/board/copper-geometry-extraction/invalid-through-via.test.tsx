import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rejects a through via with a layer outside the board stack", async () => {
  const circuit = await renderCopperGeometryBoard({
    allowBlindAndBuriedVias: false,
    children: (
      <>
        <SectionTrace name="Signal" startLayer="inner2" />
        <SectionPin name="Contact" x={0} />
        <via
          connectsTo="net.SIGNAL"
          pcbX={0}
          pcbY={0}
          fromLayer="top"
          toLayer="inner3"
        />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit, required: ["Contact"] }),
  )
  assert.throws(() => solver.solve(), /via .* unknown copper layer inner3/)
})
