import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("ground shunts do not create a bypass across a single-ended load cut", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <AdmissionChannel route="unrouted">
        <resistor
          name="RSHUNT"
          resistance="10k"
          footprint="0402"
          pcbX={-3}
          pcbY={3}
          connections={{ pin1: ".TX > .Y", pin2: "net.GND" }}
        />
        <resistor
          name="RLOAD"
          resistance="10k"
          footprint="0402"
          pcbX={-1}
          pcbY={2}
          connections={{ pin2: "net.GND" }}
        />
        <trace
          from=".TX > .Y"
          to=".RLOAD > .pin1"
          pcbPath={[".TX > .Y", ".RLOAD > .pin1"]}
        />
      </AdmissionChannel>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.routedTraceCuts.length, 1)
  assert.deepEqual(bindings.mappings, [])
  const [{ fromSourcePortId, toSourcePortId }] = bindings.routedTraceCuts
  const { node } = circuitNodes({
    ...bindings,
    circuit: bindings.circuitJson,
  })
  assert.notEqual(node(fromSourcePortId), node(toSourcePortId))
})
