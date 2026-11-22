import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import "../../fixtures/extend-expect-circuit-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test.failing(
  "routed differential terminations stay electrically distinct",
  async () => {
    const circuitJson = await renderSignals({
      tree: <Differential routedTermination />,
      expectedErrors: ["pcb_port_not_connected_error"],
    })
    const solver = new RoutedAdmissionSolver({
      circuitJson,
      ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
    })
    solver.solve()
    const [{ bindings, sections }] = solver.getOutput().value
    const { node } = circuitNodes({
      ...bindings,
      circuit: bindings.circuitJson,
    })
    const db = cju(circuitJson)
    const { channelPcbTraceIds } = sections.scope
    assert.equal(channelPcbTraceIds.length, 4)
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
