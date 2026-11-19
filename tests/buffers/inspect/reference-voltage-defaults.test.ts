import { test } from "bun:test"
import assert from "node:assert/strict"
import { referenceVoltages } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("reference voltages default to the typical voltage range and ground", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    voltageReferences: "[Voltage Range] 1.2 1.1 1.3",
  })
  assert.deepEqual(referenceVoltages(inspectedPin({ board, text })), {
    pullup: 1.2,
    pulldown: 0,
    powerClamp: 1.2,
    groundClamp: 0,
  })
})
