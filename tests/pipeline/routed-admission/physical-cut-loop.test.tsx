import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a pre-existing routed loop has a routed topology diagnostic", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <AdmissionChannel route="unrouted">
        <resistor
          name="R1"
          resistance="33"
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.3}
                height={0.3}
                shape="rect"
              />
            </footprint>
          }
          pcbX={-2}
          pcbY={1.5}
        />
        <resistor
          name="R2"
          resistance="33"
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.3}
                height={0.3}
                shape="rect"
              />
            </footprint>
          }
          pcbX={2}
          pcbY={1.5}
        />
        <resistor
          name="R3"
          resistance="33"
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.3}
                height={0.3}
                shape="rect"
              />
            </footprint>
          }
          pcbY={3}
        />
        <trace from=".TX > .Y" to=".R1 > .pin1" />
        <trace
          from=".R1 > .pin1"
          to=".R2 > .pin1"
          pcbPath={[".R1 > .pin1", ".R2 > .pin1"]}
        />
        <trace
          from=".R2 > .pin1"
          to=".R3 > .pin1"
          pcbPath={[".R2 > .pin1", ".R3 > .pin1"]}
        />
        <trace
          from=".R3 > .pin1"
          to=".R1 > .pin1"
          pcbPath={[".R3 > .pin1", ".R1 > .pin1"]}
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
  assert.equal(bindings.routedTraceCuts.length, 3)
  assert.throws(
    () => circuitNodes({ ...bindings, circuit: bindings.circuitJson }),
    {
      domain: "simulation",
      code: "channel_fanout",
      message: /Routed cuts form a loop/,
    },
  )
  const drawing = solver.visualize()
  assert.ok(
    drawing.texts?.some((text) =>
      text.text.includes("Routed cuts form a loop"),
    ),
  )
  assert.equal(
    drawing.polygons?.filter(
      (shape) =>
        shape.layer === "failure" && shape.label?.startsWith("Short or loop"),
    ).length,
    3,
  )
})
