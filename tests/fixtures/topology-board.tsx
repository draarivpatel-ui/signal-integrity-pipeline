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
