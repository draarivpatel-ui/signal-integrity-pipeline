import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a separate ground clamp bus resolves to the converter's ground rail", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({
    extraPin: "4 VCLAMP GND",
    mapping: `[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref
1 VSS VDD CLAMP_BUS
2 NC VDD NC
3 VSS NC NC
4 NC NC CLAMP_BUS`,
  })
  const expected = convertedReferences({ text, ...board })
  assert.equal(expected.groundClamp, board.pinMap[4])
  assert.deepEqual(inspectedPin({ board, text }).references, expected)
})
