import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
} from "../../fixtures/ibis-inspection"

test("the main rise supplies both crossings after a precursor returns below 10%", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: `[Rising Waveform]
R_fixture = 50
V_fixture = 0
0 0 NA NA
1n 0.2 NA NA
2n 0 NA NA
2.1n 1 NA NA`,
  })
  const pin = inspectedPin({ board, text })
  // The crossings on the main rise occur at 2.01 ns and 2.09 ns.
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    80,
  )
})
