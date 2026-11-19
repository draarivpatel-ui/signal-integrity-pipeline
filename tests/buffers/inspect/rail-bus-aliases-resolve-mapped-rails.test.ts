import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  railMapping,
} from "../../fixtures/ibis-inspection"

test("rail bus aliases resolve to the mapped POWER and GND pin ports", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ mapping: railMapping })
  const expected = convertedReferences({ text, ...board })
  assert.equal(expected.pullup, board.pinMap[2])
  assert.equal(expected.pulldown, board.pinMap[3])
  const pin = inspectedPin({ board, text })
  assert.deepEqual(pin.references, expected)
})
