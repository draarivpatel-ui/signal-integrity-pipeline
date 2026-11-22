import { test } from "bun:test"
import { DistanceBoundaryBoard } from "../../../fixtures/copper-scope-cases"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"
import { renderCoreSignals } from "../../../support/core-render"

test("retains the routes inside and on the distance boundary", async () => {
  const circuit = await renderCoreSignals(<DistanceBoundaryBoard />)
  expectCopperScopeSnapshot({ circuit, testPath: import.meta.path })
})
