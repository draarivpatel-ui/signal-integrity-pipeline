import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("two IBIS declarations cannot bind the same selected port", async () => {
  const board = await ibisInspectionBoard()
  const record = board.circuit.find(
    (row) => row.type === "simulation_ibis_model",
  )
  assert.ok(record)
  // Core rejects duplicate bindings in TSX, so duplicate the rendered record.
  board.circuit.push({
    ...record,
    simulation_ibis_model_id: "duplicate_binding",
  })
  assert.throws(() => inspectedPin({ board, text: inspectionIbis() }), {
    code: "ibis_pin_bound_twice",
  })
})
