import { test } from "bun:test"
import assert from "node:assert/strict"
import { pinCapabilities } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("I/O model declares its pin capabilities", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "I/O" })
  assert.deepEqual(pinCapabilities(inspectedPin({ board, text })), {
    drive: true,
    receive: true,
    disable: true,
  })
})
