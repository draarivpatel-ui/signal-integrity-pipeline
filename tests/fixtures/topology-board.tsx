import { Circuit } from "@tscircuit/core"
import React, { type JSX, type ReactNode } from "react"
import type { CircuitJson } from "../../src/board"

/** A component with one physical signal pin. */
export function SignalPin({
  name,
  x,
  y = 0,
  layer = "top",
}: {
  name: string
  x: number
  y?: number
  layer?: "top" | "bottom"
}): JSX.Element {
  return (
    <chip
      name={name}
      pcbX={x}
      pcbY={y}
      layer={layer}
      pinLabels={{ pin1: "SIG" }}
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

/** Render manual PCB routes without letting the autorouter fill in deliberate gaps. */
export async function topologyBoard(children: ReactNode): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board
      width={25}
      height={25}
      layers={2}
      routeRemaining={false}
      schematicDisabled
    >
      {children}
    </board>,
  )
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}

/** A driver stub and a schematic receiver with no footprint. */
export async function missingReceiverTerminal(): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <chip name="RX" pcbX={4} pcbY={0} pinLabels={{ pin1: "SIG" }} />
      <net name="SIGNAL" />
      <trace
        from=".TX > .SIG"
        to="net.SIGNAL"
        pcbPath={[".TX > .SIG", { x: 1, y: 0 }]}
      />
      <trace from=".RX > .SIG" to="net.SIGNAL" />
    </>,
  )
}

/** TX and RX are routed, while a same-net pin outside the channel has no trace. */
export async function unroutedExtraPin(): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <SignalPin name="RX" x={4} />
      <SignalPin name="STUB" x={0} y={4} />
      <trace
        from=".TX > .SIG"
        to=".RX > .SIG"
        pcbPath={[".TX > .SIG", ".RX > .SIG"]}
      />
      <trace from=".TX > .SIG" to=".STUB > .SIG" />
    </>,
  )
}

/** A straight route through an intermediate sampling pin. */
export async function daisyChain(): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <SignalPin name="MID" x={0} />
      <SignalPin name="RX" x={4} />
      <trace
        from=".TX > .SIG"
        to=".MID > .SIG"
        pcbPath={[".TX > .SIG", ".MID > .SIG"]}
      />
      <trace
        from=".MID > .SIG"
        to=".RX > .SIG"
        pcbPath={[".MID > .SIG", ".RX > .SIG"]}
      />
    </>,
  )
}

/** One series resistor, optionally followed by a second copper leg to a test pin. */
export async function seriesResistor(stub: boolean): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <SignalPin name="RX" x={4} />
      <resistor name="R" resistance="33" footprint="0402" pcbX={0} pcbY={0} />
      <trace
        from=".TX > .SIG"
        to=".R > .pin1"
        pcbPath={[".TX > .SIG", ".R > .pin1"]}
      />
      <trace
        from=".R > .pin2"
        to=".RX > .SIG"
        pcbPath={[".R > .pin2", ".RX > .SIG"]}
      />
      {stub && (
        <>
          <SignalPin name="TEST" x={1} y={4} />
          <trace
            from=".R > .pin2"
            to=".TEST > .SIG"
            pcbPath={[".R > .pin2", ".TEST > .SIG"]}
          />
        </>
      )}
    </>,
  )
}

/** Top and bottom traces meet at a plated terminal. */
export async function platedHoleRoute(): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <chip
        name="MID"
        pcbX={0}
        pcbY={0}
        pinLabels={{ pin1: "SIG" }}
        footprint={
          <footprint>
            <platedhole
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              shape="circle"
              holeDiameter={0.2}
              outerDiameter={0.4}
            />
          </footprint>
        }
      />
      <SignalPin name="RX" x={4} layer="bottom" />
      <trace
        from=".TX > .SIG"
        to=".MID > .SIG"
        pcbPath={[".TX > .SIG", ".MID > .SIG"]}
      />
      <trace
        from=".RX > .SIG"
        to=".MID > .SIG"
        pcbPath={[".RX > .SIG", ".MID > .SIG"]}
      />
    </>,
  )
}

/** Top and bottom traces meet at a separately rendered via. */
export async function standaloneViaRoute(): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <SignalPin name="RX" x={4} layer="bottom" />
      <net name="SIGNAL" />
      <via
        name="V"
        pcbX={0}
        pcbY={0}
        layers={["top", "bottom"]}
        holeDiameter={0.2}
        outerDiameter={0.45}
        connectsTo="net.SIGNAL"
      />
      <trace
        from=".TX > .SIG"
        to=".V > .top"
        connectsTo={[".TX > .SIG", ".V > .top", "net.SIGNAL"]}
        pcbPath={[".TX > .SIG", ".V > .top"]}
      />
      <trace
        from=".RX > .SIG"
        to=".V > .bottom"
        connectsTo={[".RX > .SIG", ".V > .bottom", "net.SIGNAL"]}
        pcbPath={[".RX > .SIG", ".V > .bottom"]}
      />
    </>,
  )
}

/** Two connected same-layer traces cross again between their route vertices. */
export async function crossingRoute(): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <SignalPin name="RX" x={4} />
      <SignalPin name="END" x={0} y={4} />
      <trace
        from=".TX > .SIG"
        to=".RX > .SIG"
        pcbPath={[".TX > .SIG", ".RX > .SIG"]}
      />
      <trace
        from=".RX > .SIG"
        to=".END > .SIG"
        pcbPath={[".RX > .SIG", { x: -4, y: -4 }, ".END > .SIG"]}
      />
    </>,
  )
}

/** A named-net trace passes the receiver at a specified offset from its pad center. */
export async function padContactRoute({
  offset,
  layer = "top",
}: {
  offset: number
  layer?: "top" | "bottom"
}): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TX" x={-4} />
      <SignalPin name="RX" x={4} layer={layer} />
      <net name="SIGNAL" />
      <trace
        width={0.1}
        from=".TX > .SIG"
        to="net.SIGNAL"
        pcbPath={[".TX > .SIG", { x: 2, y: offset }, { x: 7.86, y: offset }]}
      />
      <trace from=".RX > .SIG" to="net.SIGNAL" />
    </>,
  )
}

/** Two copper paths each pass through a pad of a cross-leg termination load. */
export async function differentialTerminationRoute(): Promise<CircuitJson> {
  return topologyBoard(
    <>
      <SignalPin name="TXP" x={-4} y={-0.825} />
      <SignalPin name="TXN" x={-4} y={0.825} />
      <SignalPin name="RXP" x={4} y={-0.825} />
      <SignalPin name="RXN" x={4} y={0.825} />
      <resistor
        name="TERM"
        resistance="120"
        footprint="0603"
        pcbRotation={90}
      />
      <trace
        from=".TXP > .SIG"
        to=".TERM > .pin1"
        pcbPath={[".TXP > .SIG", ".TERM > .pin1"]}
      />
      <trace
        from=".TERM > .pin1"
        to=".RXP > .SIG"
        pcbPath={[".TERM > .pin1", ".RXP > .SIG"]}
      />
      <trace
        from=".TXN > .SIG"
        to=".TERM > .pin2"
        pcbPath={[".TXN > .SIG", ".TERM > .pin2"]}
      />
      <trace
        from=".TERM > .pin2"
        to=".RXN > .SIG"
        pcbPath={[".TERM > .pin2", ".RXN > .SIG"]}
      />
    </>,
  )
}
