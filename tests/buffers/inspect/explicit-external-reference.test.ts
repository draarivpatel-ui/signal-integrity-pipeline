import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("an explicit external reference resolves without a vendor bus", async () => {
  const board = await ibisInspectionBoard({ references: { external: "VSS" } })
  const pin = inspectedPin({ board, text: inspectionIbis() })
  assert.equal(pin.references.external, board.pinMap[3])
})
