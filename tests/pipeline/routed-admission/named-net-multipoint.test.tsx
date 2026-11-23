import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { circuitJsonDb, selectPort } from "../../../src/board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a multipoint ideal trace can label the junction between routed cuts", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <AdmissionDaisyChain routeFinalLeg idealMiddleLeg namedNet="multipoint">
        <pcbnotetext
          text="DATA labels TX.Y and joined MID.A / JOIN.A"
          fontSize={0.45}
          pcbX={0}
          pcbY={4.8}
        />
      </AdmissionDaisyChain>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const db = circuitJsonDb(circuitJson)
  const net = db.source_net.getWhere({ name: "DATA" })
  assert.ok(net)
  const mid = selectPort({
    circuit: circuitJson,
    selector: { component: "MID", port: "A" },
  })
  const join = selectPort({
    circuit: circuitJson,
    selector: { component: "JOIN", port: "A" },
  })
  assert.ok(
    db.source_trace
      .list()
      .some(
        (trace) =>
          trace.connected_source_net_ids?.includes(net.source_net_id) &&
          trace.connected_source_port_ids.includes(mid.source_port_id) &&
          trace.connected_source_port_ids.includes(join.source_port_id),
      ),
  )
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  const { node } = circuitNodes({
    ...bindings,
    circuit: bindings.circuitJson,
  })
  assert.equal(bindings.routedTraceCuts.length, 2)
  assert.equal(bindings.mappings[1]?.sourceTraceIds?.length, 2)
  assert.equal(node(mid.source_port_id), node(join.source_port_id))
  assert.equal(new Set(sections.requiredSourcePortIds.map(node)).size, 3)
})
