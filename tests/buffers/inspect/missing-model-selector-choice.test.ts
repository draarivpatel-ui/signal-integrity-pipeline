import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a selector with several entries requires an explicit choice", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelChoices: ["Slow", "Fast"] })
  assert.throws(() => inspectedPin({ board, text }), {
    code: "ibis_model_choice",
  })
})
