import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test("captures constructor options before stepping and freezes the published result", async () => {
  const input = await renderFieldsInput()
  const baseline = new RouteFieldsSolver(input)
  baseline.solve()
  const materials = {
    maskThicknessMm: 0.02,
    maskRelativePermittivity: 3.3,
    maskLossTangent: 0.025,
    laminateLossTangent: 0.02,
  }
  const mutable = { ...input, materials, panelsPerEdge: 12 }
  const solver = new RouteFieldsSolver(mutable)
  solver.step()
  mutable.panelsPerEdge = 18
  materials.maskThicknessMm = 0.03
  solver.solve()
  const output = solver.getOutput()
  assert.deepEqual(output, baseline.getOutput())
  assert(Object.isFrozen(output))
  assert(Object.isFrozen(output.artifacts))
  assert(Object.isFrozen(solver.getConstructorParams()[0]))
})
