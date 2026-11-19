import { test } from "bun:test"
import assert from "node:assert/strict"
import { referenceVoltages } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("separate typical references supply the voltages without a voltage range", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    voltageReferences: `[Pullup Reference] 1.2 1.2 1.2
[Pulldown Reference] 0 0 0
[POWER Clamp Reference] 1.2 1.2 1.2
[GND Clamp Reference] 0 0 0`,
  })
  assert.deepEqual(referenceVoltages(inspectedPin({ board, text })), {
    pullup: 1.2,
    pulldown: 0,
    powerClamp: 1.2,
    groundClamp: 0,
  })
})
