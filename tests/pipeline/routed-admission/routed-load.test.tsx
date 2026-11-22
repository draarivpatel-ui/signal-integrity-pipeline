import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { AdmissionDaisyChain } from "../../fixtures/admission-daisy-chain"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test.failing(
  "a routed load past the declared receiver remains an extracted trace",
  async () => {
    const circuitJson = await renderCoreSignals(
      <AdmissionDaisyChain routeFinalLeg />,
    )
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
