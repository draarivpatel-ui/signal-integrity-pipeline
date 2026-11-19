import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  ramp,
} from "../../fixtures/ibis-inspection"

test("an input-only pin has no output edge duration even with ramp data", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "Input", modelData: ramp })
  const pin = inspectedPin({ board, text })
  assert.throws(() => edgeDurationSeconds(pin), {
    code: "ibis_edge_not_driving",
  })
})
