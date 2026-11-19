import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("an IBIS declaration requires the named vendor component", async () => {
  const board = await ibisInspectionBoard({ componentName: "MissingDevice" })
  assert.throws(() => inspectedPin({ board, text: inspectionIbis() }), {
    code: "ibis_component_missing",
  })
})
