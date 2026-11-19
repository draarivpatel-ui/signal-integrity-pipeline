import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a reference bus can identify its rail by signal name", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    mapping: `[Pin Mapping] pulldown_ref pullup_ref
1 VSS VDD`,
  })
  const expected = convertedReferences({ text, ...board })
  assert.equal(expected.pullup, board.pinMap[2])
  assert.deepEqual(inspectedPin({ board, text }).references, expected)
})
