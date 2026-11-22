import { test } from "bun:test"
import { ThroughHoleViaBoard } from "../../../fixtures/copper-scope-cases"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"
import { renderCoreSignals } from "../../../support/core-render"

test("includes the signal net reached by a through-hole barrel", async () => {
  const circuit = await renderCoreSignals(
    <ThroughHoleViaBoard allowBlindAndBuriedVias={false} />,
  )
  expectCopperScopeSnapshot({ circuit, testPath: import.meta.path })
})
