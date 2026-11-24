import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("draws the whole board with the open differential leg diagnostic in red", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential openPositive allowUnroutedTraces>
        <resistor
          name="RDRV"
          resistance="120"
          footprint="0402"
          pcbX={-7}
          connections={{ pin1: ".TX > .A", pin2: ".TX > .B" }}
        />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "channel_net",
    message: /BUS: no source path/,
  })
  const drawing = solver.visualize()
  assert.ok(drawing.lines?.length)
  assert.ok(drawing.texts?.length)
  const fault = drawing.texts.find((text) =>
    text.text.includes("no copper connects"),
  )
  assert.equal(fault?.color, "#b91c1c")
  assert.ok(
    drawing.texts.every((text) => text.anchorSide === "center" && text.y > 6),
  )
  assert.ok(
    drawing.lines.some(
      (line) =>
        line.layer === "failure" &&
        line.label?.includes("No routed source path"),
    ),
  )
  assert.equal(
    fault?.text,
    "BUS +: no copper connects TX pin A to RX pin A (red dashed line).",
  )
  assert.ok(
    drawing.rects?.some(
      (rect) =>
        rect.layer === "header" && rect.label?.startsWith("channel_net:"),
    ),
  )
  assert.ok(drawing.texts.every((text) => !text.text.includes("source_port_")))
  assertRouteVisual({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "plan-failure-visual",
  })
})
