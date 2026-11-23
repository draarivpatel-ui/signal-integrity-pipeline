import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { selectPort } from "../../../src/board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing("rejects an ideal bypass across a receiver-side cut and series resistor", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <AdmissionChannel route="series">
        <trace from=".RS > .pin1" to=".RX > .A" />
        <pcbnotetext
          text="Ideal RS.pin1 to RX.A bypasses RS and the right copper cut"
          pcbX={0}
          pcbY={4.8}
        />
      </AdmissionChannel>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const { routedTraceCuts } = bindings
  const from = selectPort({
    circuit: circuitJson,
    selector: { component: "RS", port: "pin2" },
  })
  const to = selectPort({
    circuit: circuitJson,
    selector: { component: "RX", port: "A" },
  })
  const cut = routedTraceCuts.find(
    ({ fromSourcePortId, toSourcePortId }) =>
      fromSourcePortId === from.source_port_id &&
      toSourcePortId === to.source_port_id,
  )
  assert.ok(cut)
  assert.equal(routedTraceCuts.length, 2)
  assert.throws(
    () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
    {
      code: "channel_short",
      message: new RegExp(
        `${cut.sourceTraceId}.*${cut.fromSourcePortId}.*${cut.toSourcePortId}`,
      ),
    },
  )
})
