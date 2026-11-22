import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { inverterModelPath } from "../../fixtures/routed-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("admission rejects a transient step that underflows to zero", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const driverModel = routedVisualIbis
    .split("[Rising Waveform]")[0]
    .replaceAll("1.98/1n", "1.98/5e-324")
  const receiverModel = routedVisualIbis.slice(
    routedVisualIbis.indexOf("[Model] LVC1G04_IN_33"),
  )
  const ibisSources = { [inverterModelPath]: driverModel + receiverModel }
  assert.throws(
    () => new RoutedAdmissionSolver({ circuitJson, ibisSources }).solve(),
    /admitted experiment.*time_per_step/,
  )
})
