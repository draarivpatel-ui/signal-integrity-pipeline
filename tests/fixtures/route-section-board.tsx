import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { Circuit } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import type { LayerRef } from "circuit-json"
import type { ReactElement, ReactNode } from "react"
import {
  type CircuitJson,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  type RouteSectionsInput,
  sourceNetMembers,
} from "../../src/board"
import { snapshot } from "../../src/kernel"

interface SectionPinProps {
  name: string
  x: number
  y?: number
  layer?: LayerRef
  net?: string
}

/** A physical pad and optional shared source net. */
export function SectionPin({
  name,
  x,
  y = 0,
  layer = "top",
  net = "net.SIGNAL",
}: SectionPinProps): ReactElement {
  return (
    <chip
      name={name}
      pcbX={x}
      pcbY={y}
      layer={layer}
      pinLabels={{ pin1: "P" }}
      connections={{ P: net }}
      footprint={
        <footprint>
          <smtpad
            portHints={["pin1"]}
            pcbX={0}
            pcbY={0}
            width={0.4}
            height={0.4}
            shape="rect"
          />
        </footprint>
      }
    />
  )
}

interface SectionTraceProps {
  name: string
  startX?: number
  endX?: number
  startY?: number
  endY?: number
  startLayer?: LayerRef
  endLayer?: LayerRef
  width?: number
  net?: string
  points?: TraceProps["pcbPath"]
  hasStartTeardrop?: boolean
}

/** A manual trace with a physical pad at each end. */
export function SectionTrace({
  name,
  startX = -4,
  endX = 4,
  startY = 0,
  endY = startY,
  startLayer = "top",
  endLayer = startLayer,
  width = 0.2,
  net = "net.SIGNAL",
  points = [],
  hasStartTeardrop,
}: SectionTraceProps): ReactElement {
  const from = `.${name}Start > .P`
  const to = `.${name}End > .P`
  return (
    <>
      <SectionPin
        name={`${name}Start`}
        x={startX}
        y={startY}
        net={net}
        layer={startLayer}
      />
      <SectionPin
        name={`${name}End`}
        x={endX}
        y={endY}
        net={net}
        layer={endLayer}
      />
      <trace
        name={name}
        from={from}
        to={to}
        width={width}
        pcbPath={[from, ...points, to]}
        pcbTeardropStart={hasStartTeardrop}
      />
    </>
  )
}

/** Render the test geometry through core. Overlaps and open ports are deliberate. */
export async function renderSectionBoard({
  children,
  allowBlindAndBuriedVias = true,
  reference = <copperpour connectsTo="net.GND" layer="bottom" unbroken />,
}: {
  children: ReactNode
  allowBlindAndBuriedVias?: boolean
  reference?: ReactNode
}): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board
      width={14}
      height={10}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      allowBlindAndBuriedVias={allowBlindAndBuriedVias}
      routeRemaining={false}
      schematicDisabled
    >
      <net name="GND" />
      <net name="SIGNAL" />
      <net name="OTHER" />
      {children}
      {reference}
    </board>,
  )
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}

/** Select the real traces and ports generated for a section fixture. */
export function getSectionInput({
  circuit,
  required = [],
  distanceMm = 1,
}: {
  circuit: CircuitJson
  required?: readonly string[]
  distanceMm?: number
}): RouteSectionsInput {
  const db = cju([...circuit])
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const channel = db.source_net.getWhere({ name: "SIGNAL" })
  const reference = db.source_net.getWhere({ name: "GND" })
  assert(channel && reference)
  const copperScope = channelCopperScope({
    circuit,
    connectivity,
    channelSourceIds: sourceNetMembers({
      connectivity,
      memberId: channel.source_net_id,
    }),
    referenceSourceIds: sourceNetMembers({
      connectivity,
      memberId: reference.source_net_id,
    }),
    railSourceIds: new Set(),
    distanceMm,
  })
  const requiredSourcePortIds = required.map((name) => {
    const component = db.source_component.getWhere({ name })
    assert(component, name)
    const port = db.source_port.getWhere({
      source_component_id: component.source_component_id,
    })
    assert(port, name)
    return port.source_port_id
  })
  return {
    circuitJson: snapshot(circuit),
    copperScope: snapshot(copperScope),
    requiredSourcePortIds,
    artifactPrefix: "route-section-test",
  }
}
