import { test } from "bun:test"
import {
  ScopeNeighborsBoard,
  renderScopeBoard,
} from "../../../fixtures/copper-scope-board"
import { expectCopperScopeSnapshot } from "../../../fixtures/copper-scope-snapshot"

test("retains adjacent-layer copper within the gap", async () => {
  const circuit = await renderScopeBoard(<ScopeNeighborsBoard />)
  expectCopperScopeSnapshot({
    circuit,
    referenceNet: "GND",
    testPath: import.meta.path,
  })
})
