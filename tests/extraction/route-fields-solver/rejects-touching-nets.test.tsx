import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("rejects touching nets", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="First" width={0.3} />
        <SectionTrace name="Other" startY={0.3} width={0.3} net="net.OTHER" />
      </>
    ),
  })
  const geometry = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  const solver = new RouteFieldsSolver({
    geometry,
    materials: { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 },
    artifactPrefix: "test",
  })
  assert.throws(
    () => solver.solve(),
    /Signal rectangles overlap or touch/,
    "touching different nets remain an explicit failure",
  )
})
