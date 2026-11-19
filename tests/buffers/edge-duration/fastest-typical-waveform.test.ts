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

test("the fastest typical output waveform supplies the edge duration", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: [
      waveform,
      waveform
        .replace("R_fixture = 50", "R_fixture = 100")
        .replace("2n", "500p"),
    ].join("\n"),
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    400,
  )
})
