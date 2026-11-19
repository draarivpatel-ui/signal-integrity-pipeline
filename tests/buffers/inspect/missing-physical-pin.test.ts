import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectBoardPins,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a selected port requires a physical pin in the vendor component", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis()
  assert.throws(
    () => inspectBoardPins({ board, text, ports: [board.pinMap[4]] }),
    { code: "ibis_pin_missing" },
  )
})
