import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("shows the ideal join and ordered cuts through the two receiver paths", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg idealMiddleLeg />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  assert.ok(
    drawing.lines?.some(
      (line) => line.label === "Ideal join" && line.strokeDash === "7,4",
    ),
  )
  assert.ok(
    drawing.texts?.some(
      (text) =>
        text.text ===
        "Direct connection from MID pin A to JOIN pin A (no trace)",
    ),
  )
  assert.ok(
    drawing.texts?.some((text) => text.text.includes("TX pin Y to MID pin A")),
  )
  assert.ok(
    drawing.texts?.some((text) => text.text.includes("JOIN pin A to RX pin A")),
  )
  assertRouteVisual({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "ideal-join-visual",
  })
})
