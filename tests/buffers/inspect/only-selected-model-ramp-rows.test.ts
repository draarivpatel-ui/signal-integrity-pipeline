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

test("only ramp rows in the selected model Ramp section are used", async () => {
  const board = await ibisInspectionBoard()
  const otherSection = "[Model Spec]\ndV/dt_r 0.36/100p 0.36/100p 0.36/100p"
  const text = inspectionIbis({
    modelType: "Output",
    modelData: [ramp, otherSection].join("\n"),
  })
  assert.equal(
    Math.round(
      edgeSeconds(inspectedPin({ board, text })) * PICOSECONDS_PER_SECOND,
    ),
    800,
  )
})
