import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("draws the series passive between its two distinct routed cuts", async () => {
  const circuitJson = await renderCoreSignals(<ChannelFixture route="series" />)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  assert.ok(
    drawing.polygons?.some(
      (shape) => shape.layer === "topology" && shape.label === "Series passive",
    ),
  )
  assert.ok(
    drawing.texts?.some(
      (text) =>
        text.text.includes("Series passive · RS.pin1") &&
        text.text.includes("RS.pin2"),
    ),
  )
  assertRouteVisual({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "series-passive-visual",
  })
})
