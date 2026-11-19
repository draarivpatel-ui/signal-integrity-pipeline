import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  waveform,
} from "../../fixtures/ibis-inspection"

test("a waveform with an interior gap in the typical voltage is rejected", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: waveform.replace("2n 0.6", "200p NA 0.01 NA\n2n 0.6"),
  })
  assert.throws(() => inspectedPin({ board, text }), {
    code: "missing_corner",
    message: "Fast: rising waveform sample at 2e-10 s has no typical value",
  })
})
