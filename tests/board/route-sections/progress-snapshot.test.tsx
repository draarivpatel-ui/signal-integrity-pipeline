import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeSectionSteps } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "earlier sectioning progress does not change after the next trace",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace name="First" />
          <SectionTrace name="Second" startY={0.6} />
        </>
      ),
    })
    const steps = routeSectionSteps({
      circuit,
      scope: getSectionInput({ circuit }).copperScope,
    })
    const first = steps.next()
    assert.equal(first.done, false)
    const report = JSON.stringify(first.value)
    steps.next()
    assert.equal(JSON.stringify(first.value), report)
  },
)
