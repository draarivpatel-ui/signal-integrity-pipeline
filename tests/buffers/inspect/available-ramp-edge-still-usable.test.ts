import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeSeconds } from "../../../src/buffers/inspect"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
} from "../../fixtures/ibis-inspection"

test("an unavailable typical ramp row leaves the other edge usable", async () => {
  const board = await ibisInspectionBoard()
  const modelData = "[Ramp]\ndV/dt_r 0.36/na NA NA\ndV/dt_f 0.36/600p NA NA"
  const text = inspectionIbis({ modelType: "Output", modelData })
  assert.equal(
    Math.round(
      edgeSeconds(inspectedPin({ board, text })) * PICOSECONDS_PER_SECOND,
    ),
    800,
  )
})
