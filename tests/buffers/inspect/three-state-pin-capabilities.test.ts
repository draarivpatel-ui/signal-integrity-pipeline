import { test } from "bun:test"
import assert from "node:assert/strict"
import { pinCapabilities } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("3-state model declares its pin capabilities", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "3-state" })
  assert.deepEqual(pinCapabilities(inspectedPin({ board, text })), {
    drive: true,
    receive: false,
    disable: true,
  })
})
