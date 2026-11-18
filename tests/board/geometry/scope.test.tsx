import { test } from "bun:test"
import assert from "node:assert/strict"
import type { TraceProps } from "@tscircuit/props"
import type { LayerRef } from "circuit-json"
import type React from "react"
import {
  type CircuitJson,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../../src/board"
import { renderCoreSignals } from "../../support/core-render"

/** Size in millimetres of each square test pad. */
const PAD_SIZE_MM = 0.3

/** Distance from the route midpoint to each access barrel in millimetres. */
const ACCESS_BARREL_X_MM = 7

interface WireProps {
  name: string
  y: number
  layer?: Extract<LayerRef, "top" | "inner1" | "inner2">
  extent?: number
}

/** World-mm paths with inner-layer access barrels beyond the selected endpoints. */
function Wire({
  name,
  y,
  layer = "top",
  extent = 8,
}: WireProps): React.JSX.Element {
  const from = `.${name} > .A`
  const to = `.${name} > .B`
  const left = { x: -ACCESS_BARREL_X_MM, y }
  const right = { x: ACCESS_BARREL_X_MM, y }
  const pcbPath: NonNullable<TraceProps["pcbPath"]> = [from]
  if (layer !== "top") {
    pcbPath.push(left, {
      ...left,
      via: true,
      fromLayer: "top",
      toLayer: layer,
    })
    pcbPath.push(right, {
      ...right,
      via: true,
      fromLayer: layer,
      toLayer: "top",
    })
  }
  pcbPath.push(to)
  return (
    <>
      <chip
        name={name}
        pcbY={y}
        pinLabels={{ pin1: "A", pin2: "B" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={-extent}
              pcbY={0}
              width={PAD_SIZE_MM}
              height={PAD_SIZE_MM}
              shape="rect"
            />
            <smtpad
              portHints={["pin2"]}
              pcbX={extent}
              pcbY={0}
              width={PAD_SIZE_MM}
              height={PAD_SIZE_MM}
              shape="rect"
            />
          </footprint>
        }
      />
      <trace
        name={`${name}_route`}
        from={from}
        to={to}
        width={0.1}
        pcbPath={pcbPath}
      />
    </>
  )
}

test("TSX scope retains adjacent copper, barrel spans and return pours and omits distant nets", async () => {
  const board = (
    <board
      width={24}
      height={16}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      allowBlindAndBuriedVias
    >
      <chip
        name="PAD_ONLY"
        pcbY={-0.8}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              width={PAD_SIZE_MM}
              height={PAD_SIZE_MM}
              shape="rect"
            />
          </footprint>
        }
      />
      <chip
        name="OPEN_PAD"
        pcbX={2}
        pcbY={-0.8}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              width={PAD_SIZE_MM}
              height={PAD_SIZE_MM}
              shape="rect"
            />
          </footprint>
        }
      />
      <trace from=".PAD_ONLY > .A" to="net.FLOATING" />
      <Wire name="SELECTED" y={0} extent={5} />
      <Wire name="SAME" y={1.05} />
      <Wire name="FAR" y={2} extent={10} />
      <Wire name="ADJACENT" y={-0.5} layer="inner1" extent={9} />
      <Wire name="DEEP" y={-1} layer="inner2" extent={11} />
      <copperpour name="RETURN" layer="bottom" connectsTo="net.GND" unbroken />
      <copperpour
        name="OTHER_PLANE"
        layer="inner1"
        connectsTo="net.OTHER"
        unbroken
        outline={[
          { x: -1, y: 0.8 },
          { x: 1, y: 0.8 },
          { x: 1, y: 1.4 },
          { x: -1, y: 1.4 },
        ]}
      />
    </board>
  )
  const circuit = await renderCoreSignals(board).catch(
    (error: Error & { circuitJson: CircuitJson }) => {
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
  const scope = channelCopperScope({
    circuit,
    connectivity,
    selected: sourceNetMembers(
      connectivity,
      selected.connected_source_port_ids[0],
    ),
    reference: sourceNetMembers(connectivity, ground.source_net_id),
  })
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  const retained = traces
    .filter((trace) => scope.pcbTraceIds.includes(trace.pcb_trace_id))
    .map((trace) => {
      const source = sourceTraces.find(
        (source) => source.source_trace_id === trace.source_trace_id,
      )!
      return source.name!.replace("_route", "")
    })
  assert.deepEqual(retained.sort(), ["ADJACENT", "SAME", "SELECTED"])
  assert.equal(
    scope.pcbViaIds.length,
    2,
    "adjacent-layer full physical barrels are retained",
  )
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
  assert.equal(
    scope.padOnlySourcePortIds.length,
    1,
    "the pad-only neighbour port is recorded",
  )
  assert.equal(
    scope.openPadIds.length,
    1,
    "unused disconnected leads retain their explicit open-pad approximation",
  )
  assert.equal(scope.omitted.traces, 2)
})
