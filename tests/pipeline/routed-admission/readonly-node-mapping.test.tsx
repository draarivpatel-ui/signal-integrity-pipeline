import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("the published SPICE names cannot change the node lookup", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="series" />,
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const nodes = circuitNodes({ ...bindings, circuit: bindings.circuitJson })
  const port = bindings.mappings[0].from
  const original = nodes.node(port)
  assert.notEqual(original, "0")
  assert.throws(() => {
    // @ts-expect-error Validated node names are readonly.
    nodes.mapping[port] = "0"
  }, TypeError)
  assert.equal(nodes.node(port), original)
  assert.equal(nodes.node(nodes.groundSourcePortId), "0")
})
