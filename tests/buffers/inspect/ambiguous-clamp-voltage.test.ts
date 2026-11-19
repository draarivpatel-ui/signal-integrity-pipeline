import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertedReferences,
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("an independent clamp voltage requires a mapped clamp rail", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    voltageReferences: `[Voltage Range] 1.2 1.2 1.2
[POWER Clamp Reference] 3.3 3.3 3.3
[POWER Clamp]
-1 -1m -1m -1m
1 1m 1m 1m`,
  })
  assert.throws(() => convertedReferences({ text, ...board }), {
    code: "ambiguous_reference",
  })
  assert.throws(() => inspectedPin({ board, text }), {
    code: "ibis_reference_ambiguous",
  })
})
