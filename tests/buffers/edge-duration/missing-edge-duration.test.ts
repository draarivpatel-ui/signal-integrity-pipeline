import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a driving pin without waveform or ramp data has no edge duration", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "Output" })
  const pin = inspectedPin({ board, text })
  assert.throws(() => edgeDurationSeconds(pin), {
    code: "ibis_edge_duration_missing",
  })
})
