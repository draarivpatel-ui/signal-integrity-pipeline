import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import {
  listChannelSimulations,
  prepareChannelSimulationById,
} from "../../../src/pipeline/signals"
import { routedAdmissionInput } from "../../fixtures/routed-fixture"
import { vendorAvailable, vendorModels } from "../../fixtures/vendor-models"

test.skipIf(!vendorAvailable(vendorModels.cmos.file))(
  "vendor admission uses shared channel simulation preparation",
  async () => {
    const input = await routedAdmissionInput()
    const [id] = listChannelSimulations(input.circuitJson).map(
      (channelSimulation) =>
        channelSimulation.simulation_pcb_transient_channel_simulation_id,
    )
    const channelSimulation = prepareChannelSimulationById({
      circuit: input.circuitJson,
      sources: input.ibisSources,
      simulationPcbTransientChannelSimulationId: id,
      distanceMm: input.scopeDistanceMm,
    })
    const solver = new RoutedAdmissionSolver(input)
    solver.step()
    assert.equal(solver.solved, true)
    const [plan] = solver.getOutput().value
    assert.deepEqual(plan.sections.circuitJson, channelSimulation.circuit)
    assert.deepEqual(
      plan.sections.copperScope,
      channelSimulation.settings.copperScope,
    )
    assert.deepEqual(plan.warnings, [])
    assert.equal(
      solver.getOutput().value[0].sections.copperScope.channelPcbTraceIds
        .length,
      2,
    )
    const drawing = solver.visualize()
    const marks = drawing.polygons?.filter(
      (polygon) => polygon.layer === "endpoints",
    )
    assert.ok(marks)
    assert.equal(
      marks.filter(
        (mark) =>
          mark.label?.includes("Driver") &&
          mark.points.length === 3 &&
          mark.fill !== "#fff",
      ).length,
      2,
      "each driver has one filled triangle",
    )
    assert.equal(
      marks.filter(
        (mark) =>
          mark.label?.includes("Receiver") &&
          mark.fill === "#fff" &&
          mark.stroke !== "none",
      ).length,
      2,
      "each receiver has one white-centered ring",
    )
    assert.throws(
      () => new RoutedAdmissionSolver({ ...input, scopeDistanceMm: 0 }).solve(),
      /scope distance/,
    )
  },
)
