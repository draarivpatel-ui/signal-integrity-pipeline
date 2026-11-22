import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { generalDeclarations } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("a modeled endpoint beyond the receiver needs its own run state", async () => {
  const circuitJson = await renderCoreSignals(
    <AdmissionDaisyChain routeFinalLeg />,
  )
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections, simulationPcbTransientChannelSimulationId }] =
    solver.getOutput().value
  const receiverPorts = bindings.mappings.flatMap(({ from, to }) => [from, to])
  const loadSourcePortId = sections.requiredSourcePortIds.find(
    (port) => !receiverPorts.includes(port),
  )
  assert.ok(loadSourcePortId)
  const { states, stimuli } =
    bindings.controls[simulationPcbTransientChannelSimulationId]
  assert.ok(
    states.some(({ source_port_id }) => source_port_id === loadSourcePortId),
  )
  assert.throws(
    () =>
      generalDeclarations({
        ...bindings,
        circuit: bindings.circuitJson,
        controls: {
          [simulationPcbTransientChannelSimulationId]: {
            states: states.filter(
              ({ source_port_id }) => source_port_id !== loadSourcePortId,
            ),
            stimuli: [...stimuli],
          },
        },
      }),
    { domain: "simulation", code: "channel_model" },
  )
})
