import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRegionPanels } from "../../../src/rlgc/cross-section-mesh"
import { partitionCrossSection } from "../../../src/rlgc/cross-section-regions"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects meshes exceeding the region budget before creating panels", () => {
  const crossSection = sectionFixture({ kind: "stripline" })
  const [{ region }] = partitionCrossSection(crossSection)
  const [conductor] = region.conductors
  const closePlane = { ...region, conductors: [{ ...conductor, zMm: 0.001 }] }
  assert.throws(() => buildRegionPanels({ region, count: 2000, extent: 24 }), {
    code: "mesh_panel_limit",
    message: /panel limit/i,
  })
  assert.throws(
    () => buildRegionPanels({ region: closePlane, count: 12, extent: 24 }),
    { code: "mesh_panel_limit", message: /panel limit/i },
  )
})
