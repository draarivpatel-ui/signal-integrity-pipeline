import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectBoardPins,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("power, ground and unconnected pins are skipped during inspection", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({ extraPin: "4 UNUSED NC" })
  const pins = inspectBoardPins({
    board,
    text,
    ports: Object.values(board.pinMap),
  })
  assert.deepEqual([...pins.keys()], [board.pinMap[1]])
})
