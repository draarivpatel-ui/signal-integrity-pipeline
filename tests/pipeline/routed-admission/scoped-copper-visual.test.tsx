import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { assertRouteVisual } from "../../fixtures/route-visual-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("admits a rendered daisy chain and visualizes the routed receiver path", async () => {
  const circuitJson = await renderCoreSignals(
    <AdmissionDaisyChain routeFinalLeg />,
  )
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  assert.ok(
    solver
      .visualizeCopper()
      .polygons?.some((polygon) => polygon.label === "board"),
  )
  solver.solve()
  const { value, artifacts } = solver.getOutput()
  assert.equal(value.length, 1)
  const [{ name, sections, bindings }] = value
  assert.equal(name, "DAISY")
  assert.equal(sections.copperScope.channelPcbTraceIds.length, 2)
  const [mapping] = bindings.mappings
  assert.equal(bindings.mappings.length, 1)
  assert.equal(mapping.port, "DATA")
  assert.ok(
    bindings.routedTraceCuts.some(
      (cut) =>
        cut.sourceTraceId === mapping.sourceTraceId &&
        cut.fromSourcePortId === mapping.from &&
        cut.toSourcePortId === mapping.to,
    ),
  )
  assert.equal(bindings.routedTraceCuts.length, 2)
  assert.equal(artifacts[0].path, "admission.json")
  const drawing = solver.visualizeCopper()
  assert.equal(drawing.polygons?.length, 4)
  assert.equal(drawing.lines?.length, 2)
  assertRouteVisual({
    drawing,
    module: "pipeline/routed-admission",
    name: "scoped-copper-visual",
  })
})
