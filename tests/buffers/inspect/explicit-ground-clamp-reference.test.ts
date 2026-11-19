import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("an explicit ground clamp can share the power clamp rail", async () => {
  const board = await ibisInspectionBoard({
    references: { groundClamp: "VDD" },
  })
  const pin = inspectedPin({ board, text: inspectionIbis() })
  assert.equal(pin.references.groundClamp, board.pinMap[2])
})
