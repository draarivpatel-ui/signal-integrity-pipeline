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
    solver.visualize().polygons?.some((polygon) => polygon.label === "board"),
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
  const drawing = solver.visualize()
  assert.equal(
    drawing.polygons?.filter(
      (shape) => shape.layer === "endpoints" && shape.label?.includes("Driver"),
    ).length,
    2,
  )
  assert.ok(
    drawing.polygons?.some((shape) => shape.label?.includes("Load RX.A")),
  )
  assert.ok(drawing.lines?.some((line) => line.layer === "scope"))
  assert.ok(
    drawing.texts?.every((text) => text.anchorSide === "center" && text.y > 6),
  )
  assert.ok(
    drawing.texts?.some(
      (text) => text.text.includes("C2") && text.text.includes("LOAD"),
    ),
  )
  assertRouteVisual({
    drawing,
    module: "pipeline/routed-admission",
    name: "scoped-copper-visual",
  })
})
