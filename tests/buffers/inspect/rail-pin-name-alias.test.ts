import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a reference bus can identify its rail by physical pin name", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    mapping: `[Pin Mapping] pulldown_ref pullup_ref
1 3 2`,
  })
  const expected = convertedReferences({ text, ...board })
  assert.equal(expected.pulldown, board.pinMap[3])
  assert.deepEqual(inspectedPin({ board, text }).references, expected)
})
