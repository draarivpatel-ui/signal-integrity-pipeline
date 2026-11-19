import { test } from "bun:test"
import assert from "node:assert/strict"
import { inspectPins } from "../../../src/buffers/inspect"
import {
  deviceAsset,
  ibisInspectionBoard,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("inspecting an endpoint does not require the unrelated chip asset", async () => {
  const board = await ibisInspectionBoard({ extraChip: true })
  const models = board.circuit.filter(
    (row) => row.type === "simulation_ibis_model",
  )
  assert.equal(models.length, 2)
  const { circuit, pinMap } = board
  const sources = { [deviceAsset]: inspectionIbis() }
  const pins = inspectPins({ circuit, sources, ports: new Set([pinMap[1]]) })
  assert.deepEqual([...pins.keys()], [pinMap[1]])
})
