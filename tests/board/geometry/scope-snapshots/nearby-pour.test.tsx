import { test } from "bun:test"
import { NearbyPourBoard } from "../../../fixtures/copper-scope-cases"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"
import { renderCoreSignals } from "../../../support/core-render"

test("includes the distant route connected to a nearby pour", async () => {
  const circuit = await renderCoreSignals(<NearbyPourBoard />)
  expectCopperScopeSnapshot({ circuit, testPath: import.meta.path })
})
