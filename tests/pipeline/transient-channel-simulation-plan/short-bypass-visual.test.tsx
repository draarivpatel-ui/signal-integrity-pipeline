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
  assert.equal(drawing.title, "SERIES — can't simulate")
  const diagnosticRows = new Set(
    drawing.rects
      ?.filter(
        (rect) =>
          rect.layer === "header" && rect.label?.startsWith("channel_short:"),
      )
      .map(({ center }) => center.y),
  )
  const explanation = drawing.texts
    ?.filter((text) => text.layer === "header" && diagnosticRows.has(text.y))
    .sort((a, b) => b.y - a.y)
  assert.equal(explanation?.length, 2)
  assert.equal(
    explanation.map(({ text }) => text).join(" "),
    "DATA is shorted: TX pin Y connects directly to RX pin A, skipping the traces and resistor RS (red dashes).",
  )
  const scaleText = drawing.texts?.find(
    (text) => text.layer === "header" && text.text === "2 mm",
  )
  assert.ok(scaleText)
  assert.ok(explanation.every((text) => text.fontSize === scaleText.fontSize))
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
  assert.ok(drawing.texts)
  const legend = drawing.texts.map(({ text }) => text).join(" ")
  assert.ok(legend.includes("red dashed arc = shortcut"))
  assert.ok(legend.includes("red dashes on trace = short or loop"))
  assert.ok(!legend.includes("purple dashes"))
  assertRouteVisual({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "short-bypass-visual",
    caption:
      "Two traces connect TX to RX through resistor RS. The plan stops because the board design also has a direct shortcut past RS and both traces.",
  })
})
