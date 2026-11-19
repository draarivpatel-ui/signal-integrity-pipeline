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

  const other = models.find(
    (model) => model.ibis_model_asset.project_relative_path === "other.ibs",
  )
  assert.ok(other)
  const otherPort = other.ibis_pin_name_to_source_port_id[1]
  assert.throws(
    () => inspectPins({ circuit, sources, ports: new Set([otherPort]) }),
    { code: "ibis_asset_missing" },
  )
})
