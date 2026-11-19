import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a finite ramp time that overflows when scaled does not supply an edge duration", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: "[Ramp]\ndV/dt_r 0.36/1.5e308 NA NA",
  })
  const pin = inspectedPin({ board, text })
  assert.throws(() => edgeDurationSeconds(pin), {
    code: "ibis_edge_duration_missing",
  })
})
