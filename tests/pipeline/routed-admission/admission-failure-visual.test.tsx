import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
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
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "channel_net",
    message: /BUS: no source path/,
  })
  const drawing = solver.visualizeCopper()
  assert.ok(drawing.lines?.length)
  assert.ok(drawing.texts?.length)
  assert.ok(drawing.texts.every((text) => text.color === "#f87171"))
  assert.match(
    drawing.texts.map((text) => text.text).join(" "),
    /BUS: no source path/,
  )
  assertRouteVisual({
    drawing,
    module: "pipeline/routed-admission",
    name: "admission-failure-visual",
  })
})
