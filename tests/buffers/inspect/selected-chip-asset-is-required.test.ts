import { test } from "bun:test"
import assert from "node:assert/strict"
import { inspectPins } from "../../../src/buffers/inspect"
import {
  deviceAsset,
  ibisInspectionBoard,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("inspecting an endpoint requires the selected chip asset", async () => {
  const { circuit } = await ibisInspectionBoard({ extraChip: true })
  const sources = { [deviceAsset]: inspectionIbis() }
  const other = circuit.find(
    (model) =>
      model.type === "simulation_ibis_model" &&
      model.ibis_model_asset.project_relative_path === "other.ibs",
  )
  assert.ok(other?.type === "simulation_ibis_model")
  const otherPort = other.ibis_pin_name_to_source_port_id[1]
  assert.throws(
    () => inspectPins({ circuit, sources, ports: new Set([otherPort]) }),
    { code: "ibis_asset_missing" },
  )
})
