import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test("rejects invalid panel counts before the first solve", async () => {
  const input = await renderFieldsInput()
  for (const panelsPerEdge of [2, 5, 6.5]) {
    assert.throws(() => new RouteFieldsSolver({ ...input, panelsPerEdge }), {
      code: "cross_section_options",
    })
  }
})
