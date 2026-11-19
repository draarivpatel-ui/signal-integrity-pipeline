import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a chip without mapped power or ground rails raises a reference diagnostic", async () => {
  const board = await ibisInspectionBoard({ mapRails: false })
  assert.throws(() => inspectedPin({ board, text: inspectionIbis() }), {
    code: "ibis_reference_ambiguous",
  })
})
