import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
} from "../../fixtures/ibis-inspection"

test("a falling edge keeps its first 10% crossing through a partial reversal", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: `[Falling Waveform]
R_fixture = 50
V_fixture = 1
0 1 NA NA
200p 0.5 NA NA
400p 0.75 NA NA
700p 0 NA NA`,
  })
  const pin = inspectedPin({ board, text })
  // The crossings occur at 40 ps and 660 ps.
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    620,
  )
})
