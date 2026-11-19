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

test("an I/O pin supplies an output edge duration", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "I/O", modelData: waveform })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    1600,
  )
})
