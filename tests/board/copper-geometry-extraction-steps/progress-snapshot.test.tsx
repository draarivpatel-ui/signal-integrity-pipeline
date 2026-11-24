import { test } from "bun:test"
import assert from "node:assert/strict"
import { stepCopperGeometryExtraction } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("earlier sectioning progress does not change after the next trace", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace name="First" />
        <SectionTrace name="Second" startY={0.6} />
      </>
    ),
  })
  const steps = stepCopperGeometryExtraction({
    circuit,
    copperScope: getCopperExtractionInput({ circuit }).copperScope,
  })
  const first = steps.next()
  assert.equal(first.done, false)
  const report = JSON.stringify(first.value)
  steps.next()
  assert.equal(JSON.stringify(first.value), report)
})
