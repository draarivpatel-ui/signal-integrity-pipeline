import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a nonpositive typical ramp ratio cannot supply an edge duration", async () => {
  const board = await ibisInspectionBoard()
  for (const ratio of ["-0.36/600p", "0.36/0", "0.36/-600p"]) {
    const text = inspectionIbis({
      modelType: "Output",
      modelData: `[Ramp]\ndV/dt_r ${ratio} NA NA`,
    })
    const pin = inspectedPin({ board, text })
    assert.throws(() => edgeDurationSeconds(pin), {
      code: "ibis_edge_duration_missing",
    })
  }
})
