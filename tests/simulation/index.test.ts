import { test } from "bun:test"
import assert from "node:assert/strict"
import { namespaceSpice } from "../../src/simulation"

test("subcircuit namespaces preserve terminal names and disambiguate internal models", () => {
  const renamed = namespaceSpice({
    source: ".subckt FILTER A B\nR1 A B 120\n.ends FILTER\n",
    prefix: "P0",
  })
  assert.equal(renamed.wrapper, "P0_FILTER")
  assert.match(renamed.source, /R1 A B 120/)
})
