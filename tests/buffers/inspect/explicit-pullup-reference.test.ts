import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  railMapping,
} from "../../fixtures/ibis-inspection"

test("an explicit pullup reference overrides the vendor bus", async () => {
  const board = await ibisInspectionBoard({
    extraPin: true,
    references: { pullup: "VCLAMP" },
  })
  const text = inspectionIbis({
    mapping: railMapping,
    extraPin: "4 VCLAMP POWER",
  })
  assert.equal(inspectedPin({ board, text }).references.pullup, board.pinMap[4])
})
