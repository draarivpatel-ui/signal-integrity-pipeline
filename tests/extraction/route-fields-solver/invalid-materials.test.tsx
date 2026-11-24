import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test("rejects invalid soldermask and laminate properties before solving", async () => {
  const input = await renderFieldsInput()
  const defaults = {
    maskThicknessMm: 0.02,
    maskRelativePermittivity: 3.3,
    maskLossTangent: 0.025,
    laminateLossTangent: 0.02,
  }
  for (const materialOverride of [
    { maskThicknessMm: -0.01 },
    { maskThicknessMm: Infinity },
    { maskRelativePermittivity: 0 },
    { maskLossTangent: NaN },
    { laminateLossTangent: -0.1 },
  ]) {
    assert.throws(
      () =>
        new RouteFieldsSolver({
          ...input,
          materials: { ...defaults, ...materialOverride },
        }),
      {
        code: "cross_section_geometry",
      },
    )
  }
})
