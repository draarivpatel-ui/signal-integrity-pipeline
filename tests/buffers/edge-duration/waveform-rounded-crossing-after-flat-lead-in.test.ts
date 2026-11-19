import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
} from "../../fixtures/ibis-inspection"

test("a rounded threshold crosses after the flat waveform lead-in", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: `[Rising Waveform]
R_fixture = 50
V_fixture = 0
0 1 NA NA
1n 1 NA NA
2n 1.0000000000000002 NA NA`,
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    1000,
  )
})
