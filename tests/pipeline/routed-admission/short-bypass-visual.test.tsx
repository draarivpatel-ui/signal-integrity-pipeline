import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("highlights an ideal connection that bypasses routed cuts", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="series" short="channel" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
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
    module: "pipeline/routed-admission",
    name: "short-bypass-visual",
  })
})
