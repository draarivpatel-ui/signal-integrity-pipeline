import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("highlights an ideal connection that bypasses routed cuts", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="series" short="channel" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  assert.match(drawing.title || "", /TOPOLOGY CHECK FAILED/)
  assert.ok(
    drawing.lines?.some(
      (line) => line.layer === "failure" && line.label === "Ideal bypass",
    ),
  )
  assert.ok(
    drawing.polygons?.some(
      (shape) => shape.layer === "failure" && shape.label?.includes("TX.Y"),
    ),
  )
  assertRouteVisual({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "short-bypass-visual",
  })
})
