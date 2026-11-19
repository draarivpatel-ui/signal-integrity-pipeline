import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectBoardPins,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("a signal pin and a POWER pin cannot bind the same selected port", async () => {
  const board = await ibisInspectionBoard()
  const port = board.pinMap[1]
  // Core rejects duplicate bindings in TSX, so change the rendered POWER binding.
  board.pinMap[2] = port
  const text = inspectionIbis()

  assert.throws(() => inspectBoardPins({ board, text, ports: [port] }), {
    code: "ibis_pin_bound_twice",
  })
})
