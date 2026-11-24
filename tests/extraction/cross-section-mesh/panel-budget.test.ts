import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  sectionPanels,
  sectionRegions,
} from "../../../src/extraction/cross-section-mesh"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects meshes exceeding the region budget before creating panels", () => {
  const section = sectionFixture({ kind: "stripline" })
  const [{ region }] = sectionRegions(section)
  const [conductor] = region.conductors
  const closePlane = { ...region, conductors: [{ ...conductor, zMm: 0.001 }] }
  assert.throws(
    () => sectionPanels({ region, count: 2000, extent: 24 }),
    { code: "mesh_panel_limit", message: /panel limit/i },
  )
  assert.throws(
    () => sectionPanels({ region: closePlane, count: 12, extent: 24 }),
    { code: "mesh_panel_limit", message: /panel limit/i },
  )
})
