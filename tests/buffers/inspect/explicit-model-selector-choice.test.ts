import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("the pin's explicit model selection chooses a buffer from its selector", async () => {
  const board = await ibisInspectionBoard({ modelChoice: "Fast" })
  const text = inspectionIbis({ modelChoices: ["Slow", "Fast"] })
  assert.equal(inspectedPin({ board, text }).buffer.name, "Fast")
})
