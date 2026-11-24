import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildCrossSection, RouteFieldsSolver } from "../../../src/extraction"
import { calculateRlgc } from "../../../src/rlgc"
import { renderFieldsInput } from "../../fixtures/fields-input"

test("publishes frozen matrices matching direct RLGC calculation", async () => {
  const input = await renderFieldsInput()
  const {
    copperGeometry: { geometry },
  } = input
  const solver = new RouteFieldsSolver(input)
  solver.solve()
  const result = solver.getOutput()
  const section = buildCrossSection({
    geometry,
    wireSection: geometry.sections[0],
    materials: solver.materials,
  })
  const direct = calculateRlgc({
    crossSection: section,
    options: { panelsPerEdge: 12 },
  })
  assert.deepEqual(
    result.value.solvedWireSections[0].rlgcMatrices.capacitanceFaradsPerMeter,
    direct.capacitanceFaradsPerMeter,
  )
  assert.ok(
    Object.isFrozen(
      result.value.solvedWireSections[0].rlgcMatrices.capacitanceFaradsPerMeter,
    ),
  )
})
