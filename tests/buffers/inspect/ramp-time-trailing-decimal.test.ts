import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
} from "../../fixtures/ibis-inspection"

test("scientific notation with a trailing decimal is accepted in a ramp time", async () => {
  const board = await ibisInspectionBoard()
  const modelData = "[Ramp]\ndV/dt_r 0.36/1.e-9 NA NA"
  const text = inspectionIbis({ modelType: "Output", modelData })
  assert.equal(
    Math.round(
      edgeDurationSeconds(inspectedPin({ board, text })) *
        PICOSECONDS_PER_SECOND,
    ),
    1333,
  )
})
