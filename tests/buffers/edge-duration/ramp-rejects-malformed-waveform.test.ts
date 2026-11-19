import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  ramp,
} from "../../fixtures/ibis-inspection"

test("a valid ramp cannot mask a waveform with no typical voltages", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    modelData: [
      ramp,
      `[Rising Waveform]
R_fixture = 50
V_fixture = 0
0 NA 0 NA
2n NA 0.6 NA`,
    ].join("\n"),
  })
  assert.throws(() => inspectedPin({ board, text }), {
    code: "missing_corner",
    message: "Fast: rising waveform sample at 0 s has no typical value",
  })
})
