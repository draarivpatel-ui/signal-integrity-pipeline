import assert from "node:assert/strict"
import { Circuit, simulation } from "@tscircuit/core"
import {
  convertIbisModelToSpice,
  type IbisReferencePorts,
  type IbisRunConfig,
} from "@tscircuit/ibis-to-spice"
import type { IbisPinReferences } from "@tscircuit/props"
import { Fragment, type JSX } from "react"
import {
  edgeDurationSeconds,
  type IbisSources,
  type InspectedPin,
  inspectPins,
  type PinCapabilities,
  pinCapabilities,
  referenceVoltages,
} from "../../src/buffers"
import { defaultDurationSeconds } from "../../src/pipeline/timing"
import { loadVendorModel, type VendorModel } from "../support/vendor-models"
import { PICOSECONDS_PER_SECOND } from "./ibis-inspection"

/** Vendor pin assignments to bind to one chip instance in the TSX. */
type Endpoint = {
  device: VendorModel
  pin: string
  powerPin: string
  groundPin: string
  otherPowerPin?: string
  ncPin?: string
  modelChoice?: string
}

/** Expectations read from the vendor [Pin], [Model] and edge data. */
type PinEvidence = Endpoint & {
  model: string
  capabilities: PinCapabilities
  voltage: number
  edgePicoseconds?: number
  rampOnly?: boolean
}

const DRIVER = ".TX > .SIGNAL"
const RECEIVER = ".RX > .SIGNAL"
const BIT_RATE_BPS = 1e6
const OFFSET_MS = 0.002
// Four bits at 1 Mbit/s after a 2 µs offset.
const CAPTURE_PICOSECONDS = 6_000_000

/** Render one signal pin and the references it uses on a minimal chip footprint. */
function VendorChip({
  endpoint,
  name,
  pcbX,
}: {
  endpoint: Endpoint
  name: "TX" | "RX"
  pcbX: number
}): JSX.Element {
  const {
    device,
    pin,
    powerPin,
    groundPin,
    otherPowerPin,
    ncPin,
    modelChoice,
  } = endpoint
  const pinPorts = {
    [pin]: "SIGNAL",
    [powerPin]: "POWER",
    [groundPin]: "GROUND",
  }
  let referenceLabels: Record<string, IbisPinReferences> | undefined
  if (otherPowerPin) {
    pinPorts[otherPowerPin] = "OTHER_POWER"
    referenceLabels = { [pin]: { pullup: "POWER" } }
  }
  if (ncPin) pinPorts[ncPin] = "UNCONNECTED"
  const pinLabels = Object.fromEntries(
    Object.values(pinPorts).map((label, index) => [`pin${index + 1}`, label]),
  )
  let modelSelections: Record<string, string> | undefined
  if (modelChoice) modelSelections = { [pin]: modelChoice }
  return (
    <>
      <chip
        name={name}
        pcbX={pcbX}
        pinLabels={pinLabels}
        footprint={
          <footprint>
            {Object.keys(pinLabels).map((pad, index) => (
              <Fragment key={pad}>
                <smtpad
                  portHints={[pad]}
                  pcbX={0}
                  pcbY={-index}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </Fragment>
            ))}
          </footprint>
        }
      />
      <simulation.ibismodel
        componentRef={`.${name}`}
        ibisModelAsset={{
          project_relative_path: device.file,
          url: device.url,
          mimetype: "text/plain",
        }}
        ibisComponentName={device.component}
        ibisPinNameToPortLabel={pinPorts}
        ibisPinNameToReferencePortLabels={referenceLabels}
        ibisPinNameToModelName={modelSelections}
      />
    </>
  )
}

/** Check the rendered binding, converter references, capabilities, and typical edge for one pin. */
function verifyPin({
  pin,
  expected,
  bytes,
  duration,
  driving,
}: {
  pin: InspectedPin
  expected: PinEvidence
  bytes: Uint8Array | string
  duration: number
  driving: boolean
}): void {
  const { device } = expected
  const pinMap = pin.model.ibis_pin_name_to_source_port_id
  const pullup = pinMap[expected.powerPin]
  const pulldown = pinMap[expected.groundPin]
  assert.ok(pullup && pulldown)
  const references = {
    pullup,
    pulldown,
    powerClamp: pullup,
    groundClamp: pulldown,
  }
  assert.equal(pin.pin, expected.pin)
  assert.equal(pin.component.name, device.component)
  assert.equal(pin.buffer.name, expected.model)
  assert.deepEqual(pin.references, references)
  assert.deepEqual(pinCapabilities(pin), expected.capabilities)
  assert.deepEqual(referenceVoltages(pin), {
    pullup: expected.voltage,
    pulldown: 0,
    powerClamp: expected.voltage,
    groundClamp: 0,
  })

  if (expected.rampOnly) assert.equal(pin.buffer.waveforms.length, 0)
  if (expected.edgePicoseconds !== undefined) {
    assert.equal(
      Math.round(edgeDurationSeconds(pin) * PICOSECONDS_PER_SECOND),
      expected.edgePicoseconds,
    )
  }
  if (!expected.capabilities.drive) {
    assert.throws(() => edgeDurationSeconds(pin), {
      code: "ibis_edge_not_driving",
    })
  }

  const declared =
    pin.model.ibis_pin_name_to_reference_source_port_ids?.[pin.pin]
  let explicitReferences: Record<string, IbisReferencePorts> | undefined
  if (declared) {
    explicitReferences = {
      [pin.pin]: { pullup: declared.pullup_reference_source_port_id },
    }
  }
  const run: IbisRunConfig = {
    duration,
    pinStates: { [pin.port]: { mode: "input" } },
    stimuli: {},
  }
  if (driving) {
    run.pinStates[pin.port] = { mode: "output", enabled: true }
    // Static drive lets the converter report rails even for a ramp-only buffer.
    run.stimuli[pin.port] = {
      unitInterval: duration,
      startTime: 0,
      initialState: 0,
      pattern: { type: "bits", bits: "0", repeat: false },
    }
  }
  const { metadata } = convertIbisModelToSpice(
    bytes,
    {
      source: { file: device.file, sha256: device.sha256 },
      component: device.component,
      corner: "typical",
      pinMap,
      modelSelections: pin.model.ibis_pin_name_to_model_name,
      references: explicitReferences,
      packagePolicy: "omit",
    },
    run,
  )
  assert.equal(metadata.pins.length, 1)
  assert.equal(metadata.pins[0].model, expected.model)
  assert.deepEqual(metadata.pins[0].references, pin.references)
}

/** Render one real-model channel and inspect both of its emitted Circuit JSON endpoints. */
export async function verifyVendorChannel({
  driver,
  receiver,
}: {
  driver: PinEvidence
  receiver: PinEvidence
}): Promise<void> {
  const sources: IbisSources = {}
  for (const device of new Set([driver.device, receiver.device])) {
    sources[device.file] = await loadVendorModel(device)
  }

  const board = new Circuit({ platform: { partsEngineDisabled: true } })
  board.add(
    <board
      width={10}
      height={10}
      fabricatorPreset="jlcpcb_standard"
      schematicDisabled
      routeRemaining={false}
    >
      <VendorChip endpoint={driver} name="TX" pcbX={-2} />
      <VendorChip endpoint={receiver} name="RX" pcbX={2} />
      <trace from={DRIVER} to={RECEIVER} pcbPath={[DRIVER, RECEIVER]} />
      <simulation.pcbtransientchannelsimulation bitRate={BIT_RATE_BPS}>
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef={DRIVER}
          receiverRef={RECEIVER}
          pattern="0101"
          offset={`${OFFSET_MS}ms`}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>,
  )
  await board.renderUntilSettled()
  const circuit = board.getCircuitJson()
  const channels = circuit.filter(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  assert.equal(channels.length, 1)
  const [channel] = channels
  assert.equal(channel.receivers.length, 1)
  const [received] = channel.receivers
  assert.ok("source_port_id" in channel.driver && "source_port_id" in received)

  const ports = new Set(
    circuit
      .filter((record) => record.type === "simulation_ibis_model")
      .flatMap((record) =>
        Object.values(record.ibis_pin_name_to_source_port_id),
      ),
  )
  const pins = inspectPins({ circuit, sources, ports })
  assert.equal(pins.size, 2, "POWER, GND and NC pins must be skipped")
  const tx = pins.get(channel.driver.source_port_id)
  const rx = pins.get(received.source_port_id)
  assert.ok(tx && rx, "Both declared endpoints must be bound to IBIS pins")

  const duration = defaultDurationSeconds(channels)
  assert.equal(
    Math.round(duration * PICOSECONDS_PER_SECOND),
    CAPTURE_PICOSECONDS,
  )
  verifyPin({
    pin: tx,
    expected: driver,
    bytes: sources[driver.device.file],
    duration,
    driving: true,
  })
  verifyPin({
    pin: rx,
    expected: receiver,
    bytes: sources[receiver.device.file],
    duration,
    driving: false,
  })
}
