import { beforeAll, describe, test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_copper_pour, pcb_via } from "circuit-json"
import React from "react"
import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../../src/board"
import {
  ScopeNeighborsBoard,
  viaApproach,
  Wire,
} from "../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../support/core-render"

type CoreRenderError = Error & { circuitJson: CircuitJson }

describe("scope around neighboring copper", () => {
  let scope: CopperScope
  let retained: string[]

  beforeAll(async () => {
    const circuit = await renderCoreSignals(<ScopeNeighborsBoard />).catch(
      (error: CoreRenderError) => {
        const errors = error.circuitJson.filter((record) =>
          record.type.endsWith("_error"),
        )
        assert.deepEqual(
          errors.map((record) => record.type),
          ["pcb_port_not_connected_error"],
        )
        return error.circuitJson
      },
    )
    const sourceTraces = circuit.filter(
      (record) => record.type === "source_trace",
    )
    const selected = sourceTraces.find(
      (trace) => trace.name === "SELECTED_route",
    )!
    const ground = circuit
      .filter((record) => record.type === "source_net")
      .find((net) => net.name === "GND")!
    const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
    scope = channelCopperScope({
      circuit,
      connectivity,
      selected: sourceNetMembers({
        connectivity,
        seed: selected.connected_source_port_ids[0],
      }),
      reference: sourceNetMembers({ connectivity, seed: ground.source_net_id }),
    })
    const traces = circuit.filter((record) => record.type === "pcb_trace")
    retained = traces
      .filter((trace) => scope.pcbTraceIds.includes(trace.pcb_trace_id))
      .map((trace) => {
        const source = sourceTraces.find(
          (source) => source.source_trace_id === trace.source_trace_id,
        )!
        return source.name!.replace("_route", "")
      })
  })

  test("only same-layer and adjacent routes within reach are retained", () => {
    assert.deepEqual(retained.sort(), ["ADJACENT", "SAME", "SELECTED"])
    assert.equal(scope.omitted.traces, 2)
  })

  test("vias on a retained adjacent route are retained", () => {
    assert.equal(
      scope.pcbViaIds.length,
      2,
      "vias on the retained adjacent route are included",
    )
  })

  test("return copper and a nearby other-net pour are retained", () => {
    assert.equal(
      scope.pcbCopperPourIds.length,
      2,
      "return copper and nearby other-net plane remain visible",
    )
    assert.equal(
      scope.nearbyNonReferencePourIds.length,
      1,
      "the nearby other-net plane is recorded",
    )
  })

  test("a connected neighbor without a trace is recorded as a pad-only port", () => {
    assert.equal(
      scope.padOnlySourcePortIds.length,
      1,
      "the pad-only neighbour port is recorded",
    )
  })

  test("an unused disconnected lead is recorded as an open pad", () => {
    assert.equal(
      scope.openPadIds.length,
      1,
      "unused disconnected leads retain their explicit open-pad approximation",
    )
  })
})

/** Select the rendered net named SELECTED without a reference net. */
function scopeFor({
  circuit,
  distanceMm,
}: {
  circuit: CircuitJson
  distanceMm?: number
}): CopperScope {
  const source = circuit.find(
    (record) =>
      record.type === "source_trace" && record.name === "SELECTED_route",
  )
  assert(source?.type === "source_trace")
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const selected = sourceNetMembers({
    connectivity,
    seed: source.connected_source_port_ids[0],
  })
  return channelCopperScope({
    circuit,
    connectivity,
    selected,
    reference: new Set(),
    distanceMm,
  })
}

test("rectangular plated pads do not extend the scope to distant nets", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire
        name="SELECTED"
        y={0}
        extent={3}
        startPad={
          <platedhole
            portHints={["pin1"]}
            pcbX={-3}
            pcbY={0}
            shape="circular_hole_with_rect_pad"
            holeDiameter={0.25}
            rectPadWidth={0.6}
            rectPadHeight={0.6}
          />
        }
      />
      <Wire name="DISTANT" y={5} extent={3} />
    </board>,
  )
  assert.equal(scopeFor({ circuit }).pcbTraceIds.length, 1)
})

test("polygonal plated pads use their board position when testing proximity", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <chip
        name="DISTANT"
        pcbY={5}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <platedhole
              portHints={["pin1"]}
              pcbX={-3}
              pcbY={0}
              shape="hole_with_polygon_pad"
              holeShape="circle"
              holeDiameter={0.25}
              holeOffsetX={0}
              holeOffsetY={0}
              padOutline={[
                { x: -0.3, y: -0.3 },
                { x: 0.3, y: -0.3 },
                { x: 0.3, y: 0.3 },
                { x: -0.3, y: 0.3 },
              ]}
            />
          </footprint>
        }
      />
    </board>,
  )
  const pad = circuit.find((record) => record.type === "pcb_plated_hole")
  assert(pad)
  assert(!scopeFor({ circuit }).nearbyPadIds.includes(pad.pcb_plated_hole_id))
})

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

test("a nearby via barrel with explicit drill limits retains its otherwise distant net", async () => {
  const circuit = await renderCoreSignals(
    <board
      width={18}
      height={18}
      layers={4}
      allowBlindAndBuriedVias
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} layer="bottom" />
      <Wire name="DISTANT" y={5} extent={3} />
      <trace from=".DISTANT > .A" to="net.NEIGHBOR" />
      <via
        pcbX={0}
        pcbY={0.6}
        fromLayer="top"
        toLayer="inner1"
        connectsTo="net.NEIGHBOR"
      />
    </board>,
  )
  const via = circuit.find((record) => record.type === "pcb_via")
  assert(via)
  assert.deepEqual(via.layers, ["top", "inner1"])
  const shallow = scopeFor({ circuit })
  assert.deepEqual(shallow.pcbViaIds, [])
  assert.equal(shallow.pcbTraceIds.length, 1)

  // The TSX via supplies connected layers. Add the independent drill limits in Circuit JSON.
  const barrel = pcb_via.parse({
    ...via,
    topmost_drill_layer: "top",
    bottommost_drill_layer: "bottom",
  })
  const records = circuit.map((record) => {
    if (record === via) return barrel
    return record
  })
  const deep = scopeFor({ circuit: records })
  assert.deepEqual(deep.pcbViaIds, [via.pcb_via_id])
  assert.equal(deep.pcbTraceIds.length, 2)
})

test("the wire approaching a via stays on its entry layer", async () => {
  const explicit = scopeFor({ circuit: await viaApproach(true) })
  const implicit = scopeFor({ circuit: await viaApproach(false) })
  assert.deepEqual(explicit.pcbTraceIds, explicit.selectedPcbTraceIds)
  assert.deepEqual(implicit.pcbTraceIds, implicit.selectedPcbTraceIds)
})

test("a pour arc approaching the channel is retained even when its vertices are distant", async () => {
  const outline = [
    { x: -2, y: 1.5 },
    { x: -2, y: 3 },
    { x: 2, y: 3 },
    { x: 2, y: 1.5 },
  ]
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <copperpour
        name="CURVED"
        layer="top"
        connectsTo="net.ARC"
        unbroken
        outline={outline}
      />
    </board>,
  )
  const pour = circuit.find((record) => record.type === "pcb_copper_pour")
  assert(pour?.shape === "brep")
  assert.deepEqual(scopeFor({ circuit }).pcbCopperPourIds, [])

  // Add curved-edge metadata that the TSX pour outline does not accept yet.
  for (const bulge of [0.375, -0.375]) {
    const vertices = [...outline.slice(0, -1), { ...outline[3], bulge }]
    const curved = pcb_copper_pour.parse({
      ...pour,
      brep_shape: { outer_ring: { vertices }, inner_rings: [] },
    })
    const records = circuit.map((record) => {
      if (record === pour) return curved
      return record
    })
    const result = scopeFor({ circuit: records })
    const expected: CopperScope["pcbCopperPourIds"] = []
    if (bulge < 0) expected.push(pour.pcb_copper_pour_id)
    assert.deepEqual(result.pcbCopperPourIds, expected)
  }
})

test("scope rejects invalid lateral distances", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
    </board>,
  )
  for (const distanceMm of [NaN, Infinity, -Infinity, -1]) {
    assert.throws(() => scopeFor({ circuit, distanceMm }), {
      name: "RangeError",
      message: "Copper scope distance must be finite and non-negative",
    })
  }
})

test("scope accepts zero lateral distance", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
    </board>,
  )
  assert.equal(scopeFor({ circuit, distanceMm: 0 }).lateralDistanceMm, 0)
})
