import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("draws scoped copper, a driver dot and a receiver ring", async () => {
  const circuitJson = await renderCoreSignals(
    <AdmissionDaisyChain routeFinalLeg />,
  )
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  assert.ok(
    solver.visualize().polygons?.some((polygon) => polygon.label === "board"),
  )
  solver.solve()
  const drawing = solver.visualize()
  assert.equal(drawing.polygons?.length, 4)
  assert.equal(drawing.lines?.length, 2)
  assertRouteVisual({
    drawing,
    module: "pipeline/routed-admission",
    name: "scoped-copper-visual",
  })
})
