import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeSeconds } from "../../../src/buffers/inspect"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
  ramp,
} from "../../fixtures/ibis-inspection"

test("a 20–80% ramp estimates the 10–90% edge duration", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "Output", modelData: ramp })
  assert.equal(
    Math.round(
      edgeSeconds(inspectedPin({ board, text })) * PICOSECONDS_PER_SECOND,
    ),
    800,
  )
})
