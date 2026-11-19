import { test } from "bun:test"
import assert from "node:assert/strict"
import { pinCapabilities } from "../../../src/buffers/inspect"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a model type rejected by the converter cannot be used as a receiver", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "Terminator" })
  assert.throws(() => convertedReferences({ text, ...board }), {
    code: "unsupported_model_type",
  })
  assert.throws(
    () => pinCapabilities(inspectedPin({ board, text })),
    /unsupported/,
  )
})
