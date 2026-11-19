import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
} from "../../fixtures/ibis-inspection"

test("a four-point waveform measures later crossings including an exact sample", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: `[Rising Waveform]
R_fixture = 50
V_fixture = 0
0 0 NA NA
250p 0.05 NA NA
500p 0.1 NA NA
1625p 1 NA NA`,
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    1000,
  )
})
