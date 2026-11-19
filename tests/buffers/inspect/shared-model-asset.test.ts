import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  deviceAsset,
  ibisInspectionBoard,
  inspectBoardPins,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("selected chips sharing an IBIS asset use the same parsed component", async () => {
  const board = await ibisInspectionBoard({
    extraChip: true,
    extraChipAsset: deviceAsset,
  })
  const models = board.circuit.filter(
    (row) => row.type === "simulation_ibis_model",
  )
  const ports = models.map((model) => model.ibis_pin_name_to_source_port_id[1])
  const pins = inspectBoardPins({ board, text: inspectionIbis(), ports })
  assert.equal(pins.size, 2)
  const [first, second] = pins.values()
  assert.equal(first.component, second.component)
  assert.notEqual(first.references.pullup, second.references.pullup)
})
