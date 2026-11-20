import assert from "node:assert/strict"
import type { TraceProps } from "@tscircuit/props"
import type { LayerRef } from "circuit-json"
import type React from "react"
import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../src/board"
import { renderCoreSignals } from "../support/core-render"

/** Size in millimetres of each square test pad. */
const PAD_SIZE_MM = 0.3

/** Distance from the route midpoint to each access barrel in millimetres. */
const ACCESS_BARREL_X_MM = 7

interface WireProps {
  name: string
  y: number
  layer?: LayerRef
  startPad?: React.JSX.Element
  extent?: number
}

/** World-mm paths with inner-layer access barrels beyond the selected endpoints. */
export function Wire({
  name,
  y,
  layer = "top",
  extent = 8,
  startPad,
}: WireProps): React.JSX.Element {
  const from = `.${name} > .A`
  const to = `.${name} > .B`
  const left = { x: -ACCESS_BARREL_X_MM, y }
  const right = { x: ACCESS_BARREL_X_MM, y }
  const pcbPath: NonNullable<TraceProps["pcbPath"]> = [from]
  if (layer !== "top" && layer !== "bottom") {
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
  let padLayer: LayerRef = "top"
  if (layer === "bottom") padLayer = layer
  return (
    <>
      <chip
        name={name}
        pcbY={y}
        layer={padLayer}
        pinLabels={{ pin1: "A", pin2: "B" }}
        footprint={
          <footprint>
            {startPad ?? (
              <smtpad
                portHints={["pin1"]}
                pcbX={-extent}
                pcbY={0}
                width={PAD_SIZE_MM}
                height={PAD_SIZE_MM}
                shape="rect"
              />
            )}
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

/** Selected and neighboring traces, pads and pours for the proximity tests. */
export function ScopeNeighborsBoard(): React.JSX.Element {
  return (
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
}

/** Render the same via approach with or without a redundant top-layer route point. */
export async function viaApproach(explicitWire: boolean): Promise<CircuitJson> {
  const from = ".FAN > .A"
  const to = ".FAN > .B"
  const entry = { x: 7, y: 0.6 }
  const via = {
    ...entry,
    via: true,
    fromLayer: "top",
    toLayer: "bottom",
  } as const
  const pcbPath: NonNullable<TraceProps["pcbPath"]> = [from]
  if (explicitWire) pcbPath.push(entry)
  pcbPath.push(via, to)
  return renderCoreSignals(
    <board
      width={22}
      height={18}
      layers={4}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} layer="bottom" />
      <chip
        name="FAN"
        pcbY={0.6}
        pinLabels={{ pin1: "A", pin2: "B" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={-8}
              pcbY={0}
              width={0.3}
              height={0.3}
              shape="rect"
            />
            <smtpad
              portHints={["pin2"]}
              pcbX={8}
              pcbY={0}
              width={0.3}
              height={0.3}
              shape="rect"
              layer="bottom"
            />
          </footprint>
        }
      />
      <trace
        name="FAN_route"
        from={from}
        to={to}
        width={0.1}
        pcbPath={pcbPath}
      />
    </board>,
  )
}

/** Scope and retained trace names for the neighboring-copper board. */
interface ScopeNeighbors {
  scope: CopperScope
  retained: string[]
}

type CoreRenderError = Error & { circuitJson: CircuitJson }

/** Render and select the channel on the neighboring-copper board. */
export async function scopeNeighbors(): Promise<ScopeNeighbors> {
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
  const scope = channelCopperScope({
    circuit,
    connectivity,
    selected: sourceNetMembers({
      connectivity,
      seed: selected.connected_source_port_ids[0],
    }),
    reference: sourceNetMembers({ connectivity, seed: ground.source_net_id }),
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
  return { scope, retained }
}

/** Select the rendered net named SELECTED without a reference net. */
export function scopeFor({
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
