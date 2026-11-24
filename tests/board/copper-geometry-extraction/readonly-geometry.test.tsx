import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test.failing(
  "declares the frozen copper geometry fields readonly",
  async () => {
    const circuit = await renderCopperGeometryBoard({
      children: <SectionTrace name="Signal" />,
    })
    const solver = new CopperGeometryExtractionSolver(
      getCopperExtractionInput({ circuit }),
    )
    solver.solve()
    const { value: copperGeometry } = solver.getOutput()
    assert.doesNotThrow(() => {
      copperGeometry.maskThicknessMm = null
    })
  },
)
