import { test } from "bun:test"
import assert from "node:assert/strict"
import { referenceVoltages } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("explicit typical reference voltages override the voltage range and ground", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    voltageReferences: `[Voltage Range] 1.2 1.1 1.3
[Pullup Reference] 1.1 1.0 1.2
[Pulldown Reference] 0.1 0.05 0.15
[POWER Clamp Reference] 1.3 1.2 1.4
[GND Clamp Reference] 0.2 0.15 0.25`,
  })
  assert.deepEqual(referenceVoltages(inspectedPin({ board, text })), {
    pullup: 1.1,
    pulldown: 0.1,
    powerClamp: 1.3,
    groundClamp: 0.2,
  })
})
