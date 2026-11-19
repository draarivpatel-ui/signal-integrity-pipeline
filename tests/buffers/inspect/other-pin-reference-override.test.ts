import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a pullup override for a different pin leaves the inspected pin's rail unchanged", async () => {
  const board = await ibisInspectionBoard({
    extraPin: true,
    referencePin: 4,
    references: { pullup: "VCLAMP" },
  })
  const text = inspectionIbis({ extraPin: "4 AUX Fast" })
  assert.equal(inspectedPin({ board, text }).references.pullup, board.pinMap[2])
})
