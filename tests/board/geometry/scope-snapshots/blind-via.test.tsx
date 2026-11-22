import { test } from "bun:test"
import { BlindViaBoard } from "../../../fixtures/copper-scope-cases"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"
import { renderCoreSignals } from "../../../support/core-render"

test("includes a blind via on the adjacent inner layer", async () => {
  const circuit = await renderCoreSignals(<BlindViaBoard />)
  expectCopperScopeSnapshot({ circuit, testPath: import.meta.path })
})
