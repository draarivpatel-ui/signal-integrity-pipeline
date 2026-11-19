import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("pullup and pulldown cannot share a source port", async () => {
  const board = await ibisInspectionBoard({ references: { pulldown: "VDD" } })
  const text = inspectionIbis()
  assert.throws(
    () =>
      convertedReferences({
        text,
        ...board,
        references: { 1: { pulldown: board.pinMap[2] } },
      }),
    { code: "invalid_reference" },
  )
  assert.throws(() => inspectedPin({ board, text }), {
    code: "ibis_reference_short",
  })
})
