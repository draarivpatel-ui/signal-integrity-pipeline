import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
  ramp,
  waveform,
} from "../../fixtures/ibis-inspection"

test("a linear waveform gives the 10–90% edge duration ahead of a shorter ramp", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: [ramp, waveform].join("\n"),
  })
  assert.equal(
    Math.round(
      edgeDurationSeconds(inspectedPin({ board, text })) *
        PICOSECONDS_PER_SECOND,
    ),
    1600,
  )
})
