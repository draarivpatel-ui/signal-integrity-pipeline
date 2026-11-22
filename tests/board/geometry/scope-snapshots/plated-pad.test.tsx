import { test } from "bun:test"
import { PlatedPadSpanBoard } from "../../../fixtures/plated-pad-span-board"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"
import { renderCoreSignals } from "../../../support/core-render"

test("retains a plated pad that reaches the bottom-layer channel", async () => {
  const circuit = await renderCoreSignals(<PlatedPadSpanBoard rotation={90} />)
  expectCopperScopeSnapshot({ circuit, testPath: import.meta.path })
})
