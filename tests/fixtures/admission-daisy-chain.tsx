import { simulation } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import type React from "react"
import { Inverter, Reference } from "./signal-parts"

/** Two modeled inputs on one straight signal with a routed or ideal final leg. */
export function AdmissionDaisyChain({
  routeFinalLeg,
  namedNet = false,
}: {
  routeFinalLeg: boolean
  namedNet?: boolean
}): React.JSX.Element {
  const driver = ".TX > .Y"
  const middleReceiver = ".MID > .A"
  const finalReceiver = ".RX > .A"
  let finalPcbPath: TraceProps["pcbPath"]
  const receiverRefs = [middleReceiver]
  if (routeFinalLeg) finalPcbPath = [middleReceiver, finalReceiver]
  else receiverRefs.push(finalReceiver)

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
      <Inverter name="MID" x={0} y={0} driver={false} />
      <Inverter name="RX" x={5} y={0} driver={false} />
      <Reference />
      <trace
        from={driver}
        to={middleReceiver}
        width={0.2}
        pcbPath={[driver, middleReceiver]}
      />
      <trace
        from={middleReceiver}
        to={finalReceiver}
        width={0.2}
        pcbPath={finalPcbPath}
      />
      {namedNet &&
        [driver, middleReceiver, finalReceiver].map((port) => (
          <trace key={port} from={port} to="net.DATA" />
        ))}
      <simulation.pcbtransientchannelsimulation
        name="DAISY"
        bitRate="20Mbps"
        allowUnroutedTraces={!routeFinalLeg}
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef={driver}
          receiverRef={receiverRefs}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}
