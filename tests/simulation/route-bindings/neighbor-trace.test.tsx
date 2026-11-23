import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import { circuitJsonDb } from "../../../src/board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { RouteBindingsSolver } from "../../../src/simulation"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { Inverter, Reference } from "../../fixtures/signal-parts"
import { renderSignals } from "../../fixtures/signal-render"

test("binding separates neighboring extracted ports while admission maps the declared channel", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <board
        width={18}
        height={12}
        layers={4}
        thickness={1.6}
        fabricatorPreset="jlcpcb_standard"
        routeRemaining={false}
        schematicDisabled
        isViaInPadAllowed
      >
        <Inverter name="TX" x={-5} y={0} driver />
        <Inverter name="RX" x={5} y={0} driver={false} />
        <Inverter name="QUIET_TX" x={-5} y={0.8} driver />
        <Inverter name="QUIET_RX" x={5} y={0.8} driver={false} />
        <Reference />
        <trace
          from=".TX > .Y"
          to=".RX > .A"
          pcbPath={[".TX > .Y", ".RX > .A"]}
        />
        <trace
          from=".QUIET_TX > .Y"
          to=".QUIET_RX > .A"
          pcbPath={[".QUIET_TX > .Y", ".QUIET_RX > .A"]}
        />
        <simulation.pcbtransientchannelsimulation
          name="NEARBY"
          bitRate="20Mbps"
          aggressorPattern="0"
        >
          <simulation.pcbdriverreceiverchannel
            name="DATA"
            driverRef=".TX > .Y"
            receiverRef=".RX > .A"
          />
        </simulation.pcbtransientchannelsimulation>
      </board>
    ),
  })
  const admission = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
    scopeDistanceMm: 1,
  })
  admission.solve()
  const [{ bindings, sections }] = admission.getOutput().value
  const { copperScope } = sections
  const { extractedPcbTraceIds, channelPcbTraceIds } = copperScope
  assert.equal(channelPcbTraceIds.length, 1)
  assert.equal(extractedPcbTraceIds.length, 2)
  assert.equal(bindings.mappings.length, 1)
  const neighborPcbTraceId = extractedPcbTraceIds.find(
    (pcbTraceId) => !channelPcbTraceIds.includes(pcbTraceId),
  )
  assert.ok(neighborPcbTraceId)
  const db = circuitJsonDb(bindings.circuitJson)
  const neighborSourceTraceId =
    db.pcb_trace.get(neighborPcbTraceId)?.source_trace_id
  assert.ok(neighborSourceTraceId)
  assert.notEqual(bindings.mappings[0].sourceTraceId, neighborSourceTraceId)
  const neighborSourcePortIds = db.source_trace.get(
    neighborSourceTraceId,
  )?.connected_source_port_ids
  assert.equal(neighborSourcePortIds?.length, 2)
  assert.ok(neighborSourcePortIds)
  const solver = new RouteBindingsSolver({ ...bindings, copperScope })
  solver.solve()
  const { nodeMap } = solver.getOutput().value
  const [fromSourcePortId, toSourcePortId] = neighborSourcePortIds
  assert.ok(nodeMap[fromSourcePortId])
  assert.ok(nodeMap[toSourcePortId])
  assert.notEqual(nodeMap[fromSourcePortId], nodeMap[toSourcePortId])
})
