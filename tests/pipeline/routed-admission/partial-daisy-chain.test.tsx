import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { endpointPorts } from "../../../src/pipeline/signals"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a partially routed daisy chain keeps its ideal receiver connection", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionDaisyChain routeFinalLeg={false} />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings, sections } = plan
  assert.equal(sections.copperScope.channelPcbTraceIds.length, 1)
  const [driverReceiverChannel] =
    cju(circuitJson).simulation_pcb_driver_receiver_channel.list()
  const [driverSourcePortId] = endpointPorts(driverReceiverChannel.driver)
  const [middleSourcePortId, finalSourcePortId] =
    driverReceiverChannel.receivers.flatMap(endpointPorts)
  const { node } = circuitNodes({
    ...bindings,
    circuit: bindings.circuitJson,
  })
  assert.notEqual(node(driverSourcePortId), node(middleSourcePortId))
  assert.equal(node(middleSourcePortId), node(finalSourcePortId))
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 1,
    testPath: import.meta.path,
    idealConnection: `MID.A and RX.A share ${node(middleSourcePortId)} on the ideal leg`,
  })
})
