import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeFor,
  scopeNet,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("supply and reference traces stay local and only reference vias are kept board-wide", async () => {
  const circuit = await renderCoreSignals(
    <board width={24} height={24} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="GROUND" y={-0.6} extent={3} />
      <Wire name="SUPPLY" y={0.6} extent={3} />
      <Wire name="FAR_GROUND" y={-8} extent={3} />
      <Wire name="FAR_SUPPLY" y={8} extent={3} />
      <trace from=".GROUND > .A" to="net.GND" />
      <trace from=".FAR_GROUND > .A" to="net.GND" />
      <trace from=".SUPPLY > .A" to="net.VDD" />
      <trace from=".FAR_SUPPLY > .A" to="net.VDD" />
      <via
        pcbX={8}
        pcbY={-8}
        fromLayer="top"
        toLayer="bottom"
        connectsTo="net.GND"
      />
      <via
        pcbX={8}
        pcbY={8}
        fromLayer="top"
        toLayer="bottom"
        connectsTo="net.VDD"
      />
      <via
        pcbX={0}
        pcbY={0.7}
        fromLayer="top"
        toLayer="bottom"
        connectsTo="net.VDD"
      />
    </board>,
  )
  const ground = scopeNet({ circuit, name: "GND" })
  const supply = scopeNet({ circuit, name: "VDD" })
  const result = scopeFor({ circuit, referenceNet: "GND", railNets: ["VDD"] })
  const expectedRails = ["GROUND", "SUPPLY"].map(
    (name) => scopeTrace({ circuit, name }).pcb_trace_id,
  )
  assert.deepEqual(
    new Set(result.nearbyRailPcbTraceIds),
    new Set(expectedRails),
  )
  assert.deepEqual(
    new Set(result.extractedPcbTraceIds),
    new Set([...result.channelPcbTraceIds, ...expectedRails]),
  )
  assert(!result.extractedSourceIds.includes(ground))
  assert(!result.extractedSourceIds.includes(supply))
  const expectedVias = circuit
    .filter((record) => record.type === "pcb_via")
    .filter((via) => via.source_net_id === ground || via.y === 0.7)
  assert.equal(expectedVias.length, 2)
  assert.deepEqual(
    result.extractedPcbViaIds,
    expectedVias.map((via) => via.pcb_via_id),
  )
})
