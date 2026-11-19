import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  railMapping,
} from "../../fixtures/ibis-inspection"

test("an explicit clamp rail preserves the separate vendor pullup rail", async () => {
  const board = await ibisInspectionBoard({
    extraPin: true,
    references: { powerClamp: "VCLAMP" },
  })
  const text = inspectionIbis({
    mapping: railMapping
      .replaceAll("GROUND_BUS", "VSS")
      .replaceAll("POWER_BUS", "VDD"),
    extraPin: "4 VCLAMP POWER",
  })
  const expected = convertedReferences({
    text,
    ...board,
    references: { 1: { powerClamp: board.pinMap[4] } },
  })
  assert.equal(expected.pullup, board.pinMap[2])
  assert.equal(expected.powerClamp, board.pinMap[4])
  assert.deepEqual(inspectedPin({ board, text }).references, expected)
})
