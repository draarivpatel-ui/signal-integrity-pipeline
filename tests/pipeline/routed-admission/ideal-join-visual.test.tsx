import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("shows the ideal join and ordered cuts through the two receiver paths", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionDaisyChain routeFinalLeg idealMiddleLeg />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
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
        text.text.includes("Ideal join · MID.A") &&
        text.text.includes("JOIN.A"),
    ),
  )
  assert.ok(drawing.texts?.some((text) => text.text.includes("C1 → C2")))
  assertRouteVisual({
    drawing,
    module: "pipeline/routed-admission",
    name: "ideal-join-visual",
  })
})
