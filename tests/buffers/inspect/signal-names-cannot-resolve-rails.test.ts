import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  railMapping,
} from "../../fixtures/ibis-inspection"

test("a signal named after a pin mapping bus cannot serve as its rail", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({
    mapping: `${railMapping.replaceAll("GROUND_BUS", "VSS")}
4 VSS POWER_BUS`,
    extraPin: "4 POWER_BUS Fast",
  })
  const expected = convertedReferences({
    text,
    ...board,
    extraSignal: board.pinMap[4],
  })
  assert.equal(expected.pullup, board.pinMap[2])
  assert.deepEqual(inspectedPin({ board, text }).references, expected)
})
