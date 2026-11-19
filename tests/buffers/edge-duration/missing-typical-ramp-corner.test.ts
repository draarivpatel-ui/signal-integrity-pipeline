import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("ramp minimum and maximum cannot replace an unavailable typical ratio", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: `[Ramp]
dV/dt_r NA 0.36/500p 0.36/700p
dV/dt_f NA 0.36/650p 0.36/850p`,
  })
  const pin = inspectedPin({ board, text })
  assert.throws(() => edgeDurationSeconds(pin), {
    code: "ibis_edge_duration_missing",
  })
})
