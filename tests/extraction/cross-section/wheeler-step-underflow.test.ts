import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

test("rejects recession below representable wall displacement", () => {
  assert.throws(
    () =>
      solveCrossSection({
        section: sectionFixture({ kind: "stripline" }),
        options: { recessionFraction: Number.MIN_VALUE },
      }),
    { code: "cross_section_options", message: /recession displacement/i },
  )
})
