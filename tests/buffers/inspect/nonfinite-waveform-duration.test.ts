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

test("a numerically unrepresentable waveform duration leaves the ramp usable", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: [
      ramp,
      `[Rising Waveform]
R_fixture = 50
V_fixture = 0
-1.6e308 0 NA NA
0 0.3 NA NA
1.6e308 0.6 NA NA`,
    ].join("\n"),
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    800,
  )
})
