import { test } from "bun:test"
import assert from "node:assert/strict"
import { IbisError } from "@tscircuit/ibis-to-spice"
import { referenceVoltages } from "../../../src/buffers"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("reference voltage lookup rethrows an unrelated IBIS error", async () => {
  const board = await ibisInspectionBoard()
  const pin = inspectedPin({ board, text: inspectionIbis() })
  const failure = new IbisError("invalid_number", "Invalid reference voltage")
  const buffer = {
    ...pin.buffer,
    get pullupReference(): never {
      throw failure
    },
  }
  assert.throws(
    () => referenceVoltages({ buffer }),
    (error) => error === failure,
  )
})
