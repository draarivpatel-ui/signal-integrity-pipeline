import { expect, test } from "bun:test"
import { loadInspectorSample } from "../../site/channel-inspector/sample"
import {
  assignIbisModel,
  embeddedModels,
  modelPins,
  tuneIbisModel,
} from "../../site/workbench/model/ibis"

test("assigning and tuning embedded IBIS changes only the edited component and keeps the original", async () => {
  const circuit = await loadInspectorSample()
  const original = JSON.stringify(circuit)
  const models = embeddedModels(circuit)
  const pin = modelPins({ circuit, models }).find(
    ({ model, pin }) => model.component === "TX" && pin === "1",
  )!
  const assigned = assignIbisModel({
    circuit,
    pin,
    name: "Bidirectional",
    direction: "I/O",
    corner: "minimum",
  })
  const assignedModels = embeddedModels(assigned)
  const selected = modelPins({
    circuit: assigned,
    models: assignedModels,
  }).find(({ id }) => pin.id === id)!
  expect(selected.corner).toBe("minimum")
  expect(selected.name).toContain("__wb_")
  const tuned = tuneIbisModel({
    circuit: assigned,
    model: selected.model,
    name: selected.name!,
    scale: 1.5,
    capacitancePf: 2,
  })
  const tunedModel = embeddedModels(tuned)[0]
  const before = selected.model.document!.getBuffer(selected.name!)
  const after = tunedModel.document!.getBuffer(selected.name!)
  expect(after.capacitance[0]).toBe(2e-12)
  expect(after.pullup![0][1]).toBeCloseTo(before.pullup![0][1]! * 1.5)
  expect(embeddedModels(tuned)[1].source).toBe(models[1].source)
  expect(JSON.stringify(circuit)).toBe(original)
})
