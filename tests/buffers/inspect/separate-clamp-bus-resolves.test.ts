import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a separate clamp bus resolves even without a channel override", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({
    mapping: `[Pin Mapping] pulldown_ref pullup_ref power_clamp_ref
1 VSS VDD CLAMP_BUS
2 NC VDD NC
3 VSS NC NC
4 NC NC CLAMP_BUS`,
    extraPin: "4 VCLAMP POWER",
  })
  const expected = convertedReferences({ text, ...board })
  assert.equal(expected.powerClamp, board.pinMap[4])
  assert.deepEqual(inspectedPin({ board, text }).references, expected)
})
