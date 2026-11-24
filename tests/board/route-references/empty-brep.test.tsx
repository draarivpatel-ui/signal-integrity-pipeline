import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { normalizeReferencePour } from "../../../src/board/route-references"
import {
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing("omits a BRep pour with no surviving edges", async () => {
  const circuit = await renderSectionBoard({
    children: <SectionTrace name="Signal" />,
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const { outer_ring } = pour.brep_shape
  assert.deepEqual(
    normalizeReferencePour({
      ...pour,
      brep_shape: { outer_ring: { vertices: outer_ring.vertices.slice(0, 1) } },
    }),
    [],
  )
})
