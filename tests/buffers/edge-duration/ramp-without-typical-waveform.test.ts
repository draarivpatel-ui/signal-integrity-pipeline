import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
  ramp,
} from "../../fixtures/ibis-inspection"

test("the ramp supplies the edge duration when the waveform has no typical values", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: [
      ramp,
      `[Rising Waveform]
R_fixture = 50
V_fixture = 0
0 NA 0 NA
2n NA 0.6 NA`,
    ].join("\n"),
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    800,
  )
})
