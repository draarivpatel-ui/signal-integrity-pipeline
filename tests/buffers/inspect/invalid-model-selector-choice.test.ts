import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("an available buffer outside the pin's selector cannot be selected", async () => {
  const board = await ibisInspectionBoard({ modelChoice: "Slow" })
  const text = inspectionIbis({ modelChoices: ["Fast"] })
  assert.throws(() => inspectedPin({ board, text }), {
    code: "ibis_model_choice",
  })
})
