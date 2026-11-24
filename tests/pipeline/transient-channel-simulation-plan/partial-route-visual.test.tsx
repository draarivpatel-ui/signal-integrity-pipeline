import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { listChannelSimulations } from "../../../src/pipeline/signals"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "preserves existing copper when a receiver path is incomplete",
  async () => {
    const circuitJson = await renderSignals({
      tree: <ChannelFixture route="driver-only" />,
      expectedErrors: [
        "pcb_trace_missing_error",
        "pcb_port_not_connected_error",
      ],
    })
    const [channelSimulation] = listChannelSimulations(circuitJson)
    channelSimulation.allow_unrouted_traces = false
    const solver = new TransientChannelSimulationPlanSolver({
      circuitJson,
      ibisSources: { [inverterModelPath]: routedVisualIbis },
    })
    assert.throws(() => solver.solve(), { code: "channel_net" })
    const drawing = solver.visualize()
    assert.ok(
      drawing.texts?.some(
        ({ text }) =>
          text === "DATA has an incomplete route between TX and RX.",
      ),
    )
    assert.ok(
      drawing.lines?.some(({ strokeColor }) => strokeColor === "#39789a"),
    )
    assert.ok(drawing.lines?.every(({ layer }) => layer !== "failure"))
    assertRouteVisual({
      drawing,
      module: "pipeline/transient-channel-simulation-plan",
      name: "partial-route-visual",
      caption:
        "Copper runs from TX to RS. The receiver path remains incomplete beyond RS.",
    })
  },
)
