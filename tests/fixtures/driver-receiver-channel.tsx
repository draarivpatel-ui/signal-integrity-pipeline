import { Circuit, simulation } from "@tscircuit/core"
import { Fragment } from "react"
import type { SimulationPcbDriverReceiverChannel } from "../../src/board"

const DEVICE_ASSET = {
  project_relative_path: "device.ibs",
  url: "https://example.com/device.ibs",
  mimetype: "text/plain",
}

type DriverReceiverChannelOptions = {
  pattern: string
  bitRateBps: number
  offsetMs?: number
  driverDisabled?: boolean
}

/** Render one channel simulation on independent routed nets and return its emitted channel records. */
export async function driverReceiverChannels(
  options: [DriverReceiverChannelOptions, ...DriverReceiverChannelOptions[]],
): Promise<SimulationPcbDriverReceiverChannel[]> {
  const channels = options.map(({ offsetMs = 0, ...channel }, index) => ({
    ...channel,
    offsetMs,
    name: `DATA${index}`,
    tx: `TX${index}`,
    rx: `RX${index}`,
  }))
  const endpoints = channels.flatMap(({ tx, rx }, index) => {
    const y = 4 * index - 2 * (channels.length - 1)
    return [
      { name: tx, x: -2, y },
      { name: rx, x: 2, y },
    ]
  })
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board
      width={10}
      height={6 + 4 * channels.length}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {endpoints.map(({ name, x, y }) => (
        <Fragment key={name}>
          <chip
            name={name}
            pcbX={x}
            pcbY={y}
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
          <simulation.ibismodel
            componentRef={`.${name}`}
            ibisModelAsset={DEVICE_ASSET}
            ibisComponentName="Device"
            ibisPinNameToPortLabel={{ 1: "SIG" }}
          />
        </Fragment>
      ))}
      {channels.map(({ name, tx, rx }) => (
        <trace
          key={name}
          from={`.${tx} > .SIG`}
          to={`.${rx} > .SIG`}
          pcbPath={[`.${tx} > .SIG`, `.${rx} > .SIG`]}
        />
      ))}
      <simulation.pcbtransientchannelsimulation bitRate={options[0].bitRateBps}>
        {channels.map((channel) => (
          <simulation.pcbdriverreceiverchannel
            key={channel.name}
            name={channel.name}
            driverRef={`.${channel.tx} > .SIG`}
            receiverRef={`.${channel.rx} > .SIG`}
            bitRate={channel.bitRateBps}
            pattern={channel.pattern}
            offset={`${channel.offsetMs}ms`}
            driverDisabled={channel.driverDisabled}
          />
        ))}
      </simulation.pcbtransientchannelsimulation>
    </board>,
  )
  await circuit.renderUntilSettled()
  return circuit
    .getCircuitJson()
    .filter(
      (record) => record.type === "simulation_pcb_driver_receiver_channel",
    )
}
