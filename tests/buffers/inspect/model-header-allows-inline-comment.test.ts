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

test("a model header accepts a comment immediately after its name", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "Output", modelData: ramp }).replace(
    "[Model] Fast",
    "[Model] Fast| inline comment",
  )
  assert.equal(
    Math.round(
      edgeDurationSeconds(inspectedPin({ board, text })) *
        PICOSECONDS_PER_SECOND,
    ),
    800,
  )
})
