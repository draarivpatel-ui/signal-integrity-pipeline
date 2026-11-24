import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test.failing(
  "rejects invalid soldermask and laminate properties before solving",
  async () => {
    const input = await renderFieldsInput()
    const defaults = {
      maskMm: 0.02,
      maskEr: 3.3,
      maskLoss: 0.025,
      substrateLoss: 0.02,
    }
    for (const materialOverride of [
      { maskMm: -0.01 },
      { maskMm: Infinity },
      { maskEr: 0 },
      { maskLoss: NaN },
      { substrateLoss: -0.1 },
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
  },
)
