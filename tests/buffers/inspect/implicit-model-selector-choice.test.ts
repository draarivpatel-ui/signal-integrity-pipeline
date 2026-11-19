import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a selector with one entry implicitly selects its buffer", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelChoices: ["Slow"] })
  assert.equal(inspectedPin({ board, text }).buffer.name, "Slow")
})
