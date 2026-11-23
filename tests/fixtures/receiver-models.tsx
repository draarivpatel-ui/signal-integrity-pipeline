import { simulation } from "@tscircuit/core"
import type React from "react"
import { routedVisualIbis } from "./routed-visual-fixture"
import { Inverter, Reference } from "./signal-parts"

const inputModel = routedVisualIbis.split("[Model] LVC1G04_IN_33")[1]
export const receiverModelSources = {
  "models/sn74lvc1g04.ibs": routedVisualIbis
    .replace("2 A LVC1G04_IN_33", "2 A INPUT_MODELS")
    .replace(
      "[Model] LVC1G04_OUT_33",
      `[Model Selector] INPUT_MODELS
LVC1G04_IN_33 Default input
AlternateInput Alternate input
[Model] LVC1G04_OUT_33`,
    )
    .replace("[End]", `[Model] AlternateInput${inputModel}`),
}

/** One routed receiver referenced twice within the same channel. */
export function ReceiverModels({
  secondModel,
}: {
  secondModel: string
}): React.JSX.Element {
  const driverRef = ".TX > .Y"
  const receiverRef = ".RX > .A"
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
      <trace
        from={driverRef}
        to={receiverRef}
        pcbPath={[driverRef, receiverRef]}
      />
      <simulation.pcbtransientchannelsimulation bitRate="20Mbps">
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef={driverRef}
          receiverRef={[
            { pin: receiverRef, model: "LVC1G04_IN_33" },
            { pin: receiverRef, model: secondModel },
          ]}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}
