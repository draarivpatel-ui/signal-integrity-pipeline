import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test(
  "rejects a pad beyond both physical ends of a merged wire",
  async () => {
    const circuit = await renderSectionBoard({
      children: (
        <>
          <SectionTrace name="Lower" />
          <SectionTrace name="Upper" startY={0.29} width={0.4} />
          <SectionPin name="Open" x={4.42} y={0.195} />
        </>
      ),
    })
    const solver = new RouteSectionsSolver(
      getSectionInput({ circuit, required: ["Open"] }),
    )
    assert.throws(
      () => solver.solve(),
      /required endpoint .* has no physical wire or via contact/,
    )
  },
)
