import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
  waveform,
} from "../../fixtures/ibis-inspection"

test("a third typical fixture can supply the fastest edge for timestep selection", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: `${waveform}
${waveform.replace("R_fixture = 50", "R_fixture = 100")}
[Rising Waveform]
R_fixture = 150
V_fixture = 0.3
0 0.2 NA NA
250p 0.8 NA NA`,
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    200,
  )
})
