import { test } from "bun:test"
import assert from "node:assert/strict"
import { sectionRoutes } from "../../../src/board"
import { RouteFieldsSolver } from "../../../src/extraction"
import { renderRoutedCopper } from "../../fixtures/routed-copper"

test("route field extraction can take more than the default solver iterations", async () => {
  const { circuitJson, copperScope: scope } = await renderRoutedCopper()
  const solver = new RouteFieldsSolver({
    geometry: sectionRoutes({ circuit: circuitJson, copperScope: scope }),
    artifactPrefix: "fields",
  })
  assert.equal(solver.MAX_ITERATIONS, Infinity)
})
