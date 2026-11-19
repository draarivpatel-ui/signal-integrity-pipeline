import { test } from "bun:test"
import assert from "node:assert/strict"
import { pinCapabilities } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("Input model declares its pin capabilities", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "Input" })
  assert.deepEqual(pinCapabilities(inspectedPin({ board, text })), {
    drive: false,
    receive: true,
    disable: false,
  })
})
