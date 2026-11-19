import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("two mapped power rails without a bus or override are ambiguous", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({ extraPin: "4 VCLAMP POWER" })
  assert.throws(() => inspectedPin({ board, text }), {
    code: "ibis_reference_ambiguous",
  })
})
