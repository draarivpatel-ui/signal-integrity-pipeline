import { simulation } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import type React from "react"
import { Inverter, Reference } from "./signal-parts"

type Route = "series" | "unrouted" | "receiver-only" | "driver-only"

/** A logical driver-to-receiver connection with optional series copper. */
export function AdmissionChannel({
  route,
  namedNets = false,
  short,
}: {
  route: Route
  namedNets?: boolean
  short?: "resistor" | "channel" | "junction"
}): React.JSX.Element {
  const driver = ".TX > .Y"
  const receiver = ".RX > .A"
  const seriesInput = ".RS > .pin1"
  const seriesOutput = ".RS > .pin2"
  let driverPath: TraceProps["pcbPath"]
  if (route === "series" || route === "driver-only")
    driverPath = [driver, seriesInput]
  const join = ".JOIN > .A"
  let receiverStart = seriesOutput
  if (short === "junction") receiverStart = join
  let receiverPath: TraceProps["pcbPath"]
  if (route !== "driver-only") receiverPath = [receiverStart, receiver]
  return (
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
      <Reference />
      {route === "unrouted" && <trace from={driver} to={receiver} />}
      {route !== "unrouted" && (
        <>
          <resistor
            name="RS"
            resistance="33"
            pcbX={0}
            footprint={
              <footprint>
                <smtpad
                  portHints={["pin1"]}
                  pcbX={-0.5}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
                <smtpad
                  portHints={["pin2"]}
                  pcbX={0.5}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </footprint>
            }
          />
          <trace
            from={driver}
            to={seriesInput}
            width={0.2}
            pcbPath={driverPath}
          />
          <trace
            from={receiverStart}
            to={receiver}
            width={0.2}
            pcbPath={receiverPath}
          />
        </>
      )}
      {short === "junction" && (
        <>
          <Inverter name="JOIN" x={2.5} y={0} driver={false} />
          <trace from={seriesOutput} to={join} />
          <trace from={seriesInput} to={join} />
        </>
      )}
      {short === "resistor" && <trace from={seriesInput} to={seriesOutput} />}
      {short === "channel" && <trace from={driver} to={receiver} />}
      {namedNets && (
        <>
          <trace from={driver} to="net.DRIVER" />
          <trace from={seriesInput} to="net.DRIVER" />
          <trace from={seriesOutput} to="net.RECEIVER" />
          <trace from={receiver} to="net.RECEIVER" />
        </>
      )}
      <simulation.pcbtransientchannelsimulation
        name="SERIES"
        bitRate="20Mbps"
        allowUnroutedTraces
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef={driver}
          receiverRef={receiver}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}
