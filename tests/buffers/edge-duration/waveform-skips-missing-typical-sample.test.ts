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

test("a partial typical waveform skips an unavailable voltage sample", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: waveform.replace("2n 0.6", "200p NA 0.01 NA\n2n 0.6"),
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    1600,
  )
})
