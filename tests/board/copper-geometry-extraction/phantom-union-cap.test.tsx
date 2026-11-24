import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("rejects a pad beyond both physical ends of a merged wire", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="Lower" />
        <SectionTrace name="Upper" startY={0.29} width={0.4} />
        <SectionPin name="Open" x={4.42} y={0.195} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit, required: ["Open"] }),
  )
  assert.throws(
    () => solver.solve(),
    /required endpoint .* has no physical wire or via contact/,
  )
})
