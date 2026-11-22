import { test } from "bun:test"
import { RailProximityBoard } from "../../../fixtures/copper-scope-cases"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"
import { renderCoreSignals } from "../../../support/core-render"

test("marks near rails and keeps the distant return via", async () => {
  const circuit = await renderCoreSignals(<RailProximityBoard />)
  expectCopperScopeSnapshot({
    circuit,
    referenceNet: "GND",
    railNets: ["VDD"],
    testPath: import.meta.path,
  })
})
