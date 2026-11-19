import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  PICOSECONDS_PER_SECOND,
} from "../../fixtures/ibis-inspection"

test("a zero-voltage ramp leaves the other edge usable", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: "[Ramp]\ndV/dt_r 0/200p NA NA\ndV/dt_f 0.36/600p NA NA",
  })
  const pin = inspectedPin({ board, text })
  assert.equal(
    Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
    800,
  )
})
