import { test } from "bun:test"
import assert from "node:assert/strict"
import { pinCapabilities } from "../../../src/buffers/inspect"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("converter-supported model types declare their pin roles", async () => {
  const board = await ibisInspectionBoard()
  const types = [
    ["Input", { drive: false, receive: true, disable: false }],
    ["Output", { drive: true, receive: false, disable: false }],
    ["I/O", { drive: true, receive: true, disable: true }],
    ["3-state", { drive: true, receive: false, disable: true }],
  ] as const
  for (const [modelType, expected] of types) {
    const pin = inspectedPin({ board, text: inspectionIbis({ modelType }) })
    assert.deepEqual(pinCapabilities(pin), expected)
  }
})
