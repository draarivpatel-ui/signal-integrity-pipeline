// Topology/transient unit-test source only.
import { simulation } from "@tscircuit/core"
import type { ResistorProps } from "@tscircuit/props"
import { Fragment, type JSX } from "react"
import { Reference, Transceiver } from "./signal-parts"

/** Differential test rate in bits per second. */
const BIT_RATE_BPS = 250e3

/** Capture this many bits from the differential channel. */
const CAPTURE_BITS = 48

/** Build an RS-485 channel, optionally swapping the differential pin order. */
export default function ({
  reversed = false,
  routedTermination = false,
  short,
  seriesPositive = false,
  internalShort = false,
}: {
  reversed?: boolean
  routedTermination?: boolean
  short?: "TX" | "RX" | "RTERM"
  seriesPositive?: boolean
  internalShort?: boolean
}): JSX.Element {
  let positive = "A"
  let negative = "B"
  if (reversed) {
    positive = "B"
    negative = "A"
  }
  let terminationX = 5
  let connections: ResistorProps["connections"] = {
    pin1: ".RX > .A",
    pin2: ".RX > .B",
  }
  if (routedTermination) {
    terminationX = 7
    connections = undefined
  }
  const driverRef = { p: `.TX > .${positive}`, n: `.TX > .${negative}` }
  const receiverRef = { p: `.RX > .${positive}`, n: `.RX > .${negative}` }
  const receiverInternalTies = []
  if (internalShort) receiverInternalTies.push(["pin6", "pin7"])
  return (
    <board
      width={20}
      height={12}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      <Transceiver name="TX" x={-5} />
      <Transceiver
        name="RX"
        x={5}
        internallyConnectedPins={receiverInternalTies}
      />
      <Reference />
      {seriesPositive ? (
        <DualTerminatedPositiveLeg />
      ) : (
        <trace
          from=".TX > .A"
          to=".RX > .A"
          width={0.2}
          pcbPath={[".TX > .A", ".RX > .A"]}
        />
      )}
      <trace
        from=".TX > .B"
        to=".RX > .B"
        width={0.2}
        pcbPath={[".TX > .B", ".RX > .B"]}
      />
      <resistor
        name="RTERM"
        resistance="120"
        pcbX={terminationX}
        connections={connections}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0.3}
              width={0.25}
              height={0.25}
              shape="rect"
            />
            <smtpad
              portHints={["pin2"]}
              pcbX={0}
              pcbY={-0.3}
              width={0.25}
              height={0.25}
              shape="rect"
            />
          </footprint>
        }
      />
      {routedTermination && (
        <>
          <trace
            from=".RX > .A"
            to=".RTERM > .pin1"
            width={0.2}
            pcbPath={[".RX > .A", ".RTERM > .pin1"]}
          />
          <trace
            from=".RX > .B"
            to=".RTERM > .pin2"
            width={0.2}
            pcbPath={[".RX > .B", ".RTERM > .pin2"]}
          />
        </>
      )}
      {short === "TX" && <trace from=".TX > .A" to=".TX > .B" />}
      {short === "RX" && <trace from=".RX > .A" to=".RX > .B" />}
      {short === "RTERM" && <trace from=".RTERM > .pin1" to=".RTERM > .pin2" />}
      <simulation.pcbtransientchannelsimulation
        name="RS485"
        aggressorDisabled
        bitRate={BIT_RATE_BPS}
        duration={CAPTURE_BITS / BIT_RATE_BPS}
      >
        <simulation.pcbdriverreceiverchannel
          name="BUS"
          driverRef={driverRef}
          receiverRef={receiverRef}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

/** Give P a longer physical path than the source shortcut through both terminations. */
function DualTerminatedPositiveLeg(): JSX.Element {
  const footprints = [-3, -1, 1, 3]
  const names = footprints.map((_, index) => `RS${index + 1}`)
  const from = [".TX > .A", ...names.map((name) => `.${name} > .pin2`)]
  const to = [...names.map((name) => `.${name} > .pin1`), ".RX > .A"]
  return (
    <>
      <resistor
        name="RDRV"
        resistance="120"
        footprint="0402"
        pcbX={-7}
        connections={{ pin1: ".TX > .A", pin2: ".TX > .B" }}
      />
      {names.map((name, index) => (
        <Fragment key={name}>
          <resistor
            name={name}
            resistance="33"
            footprint="0402"
            pcbX={footprints[index]}
            pcbY={0.3}
          />
        </Fragment>
      ))}
      {from.map((pin, index) => (
        <Fragment key={pin}>
          <trace
            from={pin}
            to={to[index]}
            width={0.15}
            pcbPath={[pin, to[index]]}
          />
        </Fragment>
      ))}
    </>
  )
}
