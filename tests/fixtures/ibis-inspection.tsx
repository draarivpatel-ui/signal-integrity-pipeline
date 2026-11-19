import assert from "node:assert/strict"
import { Circuit, simulation } from "@tscircuit/core"
import {
  convertIbisModelToSpice,
  type IbisConversionMetadata,
  type IbisModelDefinition,
} from "@tscircuit/ibis-to-spice"
import React from "react"
import type { CircuitJson, SimulationIbisModel } from "../../src/board"
import { type InspectedPin, inspectPins } from "../../src/buffers/inspect"

export const deviceAsset = "device.ibs"
const pinLabels = { pin1: "DQ", pin2: "VDD", pin3: "VSS", pin4: "VCLAMP" }
const powerPins = { 1: "DQ", 2: "VDD", 3: "VSS" }

type BoardOptions = {
  extraPin?: boolean
  powerClamp?: string
  extraChip?: boolean
}

/** The rendered chip records and the source port IDs assigned to its IBIS pins. */
type InspectionBoard = {
  circuit: CircuitJson
  pinMap: SimulationIbisModel["ibis_pin_name_to_source_port_id"]
}

type ChipOptions = Omit<BoardOptions, "extraChip"> & {
  name: string
  asset: string
}

/** Make one chip and its Circuit JSON IBIS declaration. */
function InspectionChip({
  name,
  asset,
  extraPin,
  powerClamp,
}: ChipOptions): React.JSX.Element {
  const ibisPinNameToPortLabel: Record<number, string> = { ...powerPins }
  if (extraPin) ibisPinNameToPortLabel[4] = "VCLAMP"
  let ibisPinNameToReferencePortLabels:
    | Record<number, { powerClamp: string }>
    | undefined
  if (powerClamp) ibisPinNameToReferencePortLabels = { 1: { powerClamp } }
  return (
    <>
      <chip
        name={name}
        pinLabels={pinLabels}
        footprint={
          <footprint>
            {Object.keys(pinLabels).map((pin, index) => (
              <React.Fragment key={pin}>
                <smtpad
                  portHints={[pin]}
                  pcbX={index}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </React.Fragment>
            ))}
          </footprint>
        }
      />
      <simulation.ibismodel
        componentRef={`.${name}`}
        ibisModelAsset={{
          project_relative_path: asset,
          url: `https://example.com/${asset}`,
          mimetype: "text/plain",
        }}
        ibisComponentName="Device"
        ibisPinNameToPortLabel={ibisPinNameToPortLabel}
        ibisPinNameToReferencePortLabels={ibisPinNameToReferencePortLabels}
      />
    </>
  )
}

/** Render a selected chip and optional unrelated chip through core. */
export async function ibisInspectionBoard(
  options: BoardOptions = {},
): Promise<InspectionBoard> {
  const { extraPin, powerClamp, extraChip } = options
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board width={10} height={10} schematicDisabled routeRemaining={false}>
      <InspectionChip
        name="U1"
        asset={deviceAsset}
        extraPin={extraPin}
        powerClamp={powerClamp}
      />
      {extraChip && <InspectionChip name="U2" asset="other.ibs" />}
    </board>,
  )
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson()
  const model = records.find((row) => row.type === "simulation_ibis_model")
  if (!model)
    throw new Error("Expected the TSX declaration to emit an IBIS model")
  return { circuit: records, pinMap: model.ibis_pin_name_to_source_port_id }
}

type IbisOptions = {
  mapping?: string
  extraPin?: string
  modelType?: string
  referenceOnly?: boolean
  modelData?: string
}

/** Synthetic IBIS fixture without vendor data. */
export function inspectionIbis({
  mapping = "",
  extraPin = "",
  modelType = "Input",
  referenceOnly = false,
  modelData = "",
}: IbisOptions = {}): string {
  let references = "[Voltage Range] 1.2 1.2 1.2"
  if (referenceOnly) {
    references = `[Pullup Reference] 1.2 1.2 1.2
[Pulldown Reference] 0 0 0
[POWER Clamp Reference] 1.2 1.2 1.2
[GND Clamp Reference] 0 0 0`
  }
  return `[IBIS Ver] 5.0
[File Name] device.ibs
[File Rev] 1.0
[Component] Device
[Manufacturer] Example
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
1 DQ Fast
2 VDD POWER
3 VSS GND
${extraPin}
${mapping}
[Model] Fast
Model_type ${modelType}
C_comp 1p 1p 1p
${references}
${modelData}
[End]
`
}

/** The converter’s source port IDs for the IBIS reference roles. */
type ReferencePorts = IbisConversionMetadata["pins"][number]["references"]

/** Inspect the signal on pin 1 of the rendered chip. */
export function inspectedPin({
  board,
  text,
}: {
  board: InspectionBoard
  text: string
}): InspectedPin {
  const { circuit, pinMap } = board
  const pin = inspectPins({
    circuit,
    sources: { [deviceAsset]: text },
    ports: new Set([pinMap[1]]),
  }).get(pinMap[1])
  assert.ok(pin)
  return pin
}

/** Get the converter's references for the same chip without running a solver. */
export function convertedReferences({
  text,
  pinMap,
  extraSignal,
  references,
}: {
  text: string
  pinMap: InspectionBoard["pinMap"]
  extraSignal?: string
  references?: IbisModelDefinition["references"]
}): ReferencePorts {
  const pinStates = { [pinMap[1]]: { mode: "input" as const } }
  if (extraSignal) pinStates[extraSignal] = { mode: "input" }
  return convertIbisModelToSpice(
    text,
    {
      source: { content: text },
      component: "Device",
      corner: "typical",
      pinMap,
      references,
      packagePolicy: "omit",
    },
    {
      duration: "1ns",
      pinStates,
      stimuli: {},
    },
  ).metadata.pins[0].references
}

/** Vendor pin mapping with power and ground bus aliases. */
export const railMapping = `[Pin Mapping] pulldown_ref pullup_ref
1 GROUND_BUS POWER_BUS
2 NC         POWER_BUS
3 GROUND_BUS NC`

/** Compare the measured durations in whole picoseconds. */
export const PICOSECONDS_PER_SECOND = 1e12

/** Typical 600 ps rising and 750 ps falling ramp. */
export const ramp = `[Ramp]
dV/dt_r 0.36/600p 0.36/600p 0.36/600p
dV/dt_f 0.36/750p 0.36/750p 0.36/750p`

/** Linear rising waveform from 0 V to 0.6 V. */
export const waveform = `[Rising Waveform]
R_fixture = 50
V_fixture = 0
0 0 NA NA
1n 0.6 NA NA`
