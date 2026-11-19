import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("an external reference resolves using the converter's pullup bus matching", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({
    extraPin: "4 VCLAMP POWER",
    mapping: `[Pin Mapping] pulldown_ref pullup_ref ext_ref
1 VSS VDD EXTERNAL_BUS
2 NC VDD NC
3 VSS NC NC
4 NC EXTERNAL_BUS NC`,
  })
  const expected = convertedReferences({ text, ...board })
  assert.equal(expected.external, board.pinMap[4])
  assert.deepEqual(inspectedPin({ board, text }).references, expected)
})
