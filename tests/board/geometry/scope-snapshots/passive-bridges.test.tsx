import { test } from "bun:test"
import { PassiveBridgesBoard } from "../../../fixtures/copper-scope-cases"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"
import { renderScopeBoard } from "../../../fixtures/copper-scope-board"

test("retains the distant copper across passive bridges", async () => {
  const circuit = await renderScopeBoard(<PassiveBridgesBoard />)
  expectCopperScopeSnapshot({
    circuit,
    referenceNet: "GND",
    railNets: ["VDD"],
    testPath: import.meta.path,
  })
})
