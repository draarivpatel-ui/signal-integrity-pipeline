import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a nearby non-reference pour retains its routed net and distant copper", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="DISTANT" y={5} extent={3} />
      <trace from=".DISTANT > .A" to="net.NEIGHBOR" />
      <copperpour
        name="NEAR"
        layer="top"
        connectsTo="net.NEIGHBOR"
        unbroken
        outline={[
          { x: -3.4, y: 0.55 },
          { x: -2.6, y: 0.55 },
          { x: -2.6, y: 5.4 },
          { x: -3.4, y: 5.4 },
        ]}
      />
      <copperpour
        name="FAR"
        layer="top"
        connectsTo="net.NEIGHBOR"
        unbroken
        outline={[
          { x: 2.6, y: 4.6 },
          { x: 3.4, y: 4.6 },
          { x: 3.4, y: 5.4 },
          { x: 2.6, y: 5.4 },
        ]}
      />
    </board>,
  )
  const source = circuit.find(
    (record) =>
      record.type === "source_trace" && record.name === "DISTANT_route",
  )
  assert(source?.type === "source_trace")
  const route = circuit.find(
    (record) =>
      record.type === "pcb_trace" &&
      record.source_trace_id === source.source_trace_id,
  )
  assert(route?.type === "pcb_trace")
  const result = scopeFor({ circuit })
  assert.equal(result.nearbyNonReferencePourIds.length, 1)
  assert(result.pcbTraceIds.includes(route.pcb_trace_id))
  assert.equal(result.pcbCopperPourIds.length, 2)
})
