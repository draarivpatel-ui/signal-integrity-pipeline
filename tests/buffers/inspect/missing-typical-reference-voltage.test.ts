import { test } from "bun:test"
import assert from "node:assert/strict"
import { referenceVoltages } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("an explicit reference without a typical voltage raises a diagnostic", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    voltageReferences: `[Voltage Range] 1.2 1.1 1.3
[Pullup Reference] NA 1.0 1.2`,
  })
  const pin = inspectedPin({ board, text })
  assert.throws(() => referenceVoltages(pin), {
    code: "ibis_reference_voltage_missing",
  })
})
