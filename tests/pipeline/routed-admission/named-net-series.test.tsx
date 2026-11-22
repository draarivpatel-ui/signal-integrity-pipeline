import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test.failing(
  "redundant named nets do not short routed series segments",
  async () => {
    const circuitJson = await renderSignals({
      tree: <AdmissionChannel route="series" namedNets />,
      expectedErrors: [
        "pcb_trace_missing_error",
        "pcb_port_not_connected_error",
      ],
    })
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
    const db = cju(circuitJson)
    const { channelPcbTraceIds } = sections.scope
    assert.equal(channelPcbTraceIds.length, 2)
    for (const pcbTraceId of channelPcbTraceIds) {
      const pcbTrace = db.pcb_trace.get(pcbTraceId)
      assert.ok(pcbTrace?.source_trace_id)
      const sourceTrace = db.source_trace.get(pcbTrace.source_trace_id)
      assert.ok(sourceTrace)
      const [fromSourcePortId, toSourcePortId] =
        sourceTrace.connected_source_port_ids
      assert.notEqual(
        node(fromSourcePortId),
        node(toSourcePortId),
        sourceTrace.source_trace_id,
      )
    }
    expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  },
)
