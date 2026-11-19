import assert from "node:assert/strict"
import { Circuit, simulation } from "@tscircuit/core"
import {
  convertIbisModelToSpice,
  type IbisReferencePorts,
} from "@tscircuit/ibis-to-spice"
import type { IbisPinReferences } from "@tscircuit/props"
import React from "react"
import type { CircuitJson, SimulationIbisModel } from "../../src/board"
import {
  type InspectedPin,
  type InspectedPins,
  inspectPins,
} from "../../src/buffers"

export const deviceAsset = "device.ibs"
const pinLabels = { pin1: "DQ", pin2: "VDD", pin3: "VSS", pin4: "VCLAMP" }

type BoardOptions = {
  extraPin?: boolean
  mapRails?: boolean
  references?: IbisPinReferences
  referencePin?: number
  modelChoice?: string
  componentName?: string
  extraChip?: boolean
  extraChipAsset?: string
}

/** The rendered chip records and the source port IDs assigned to its IBIS pins. */
type InspectionBoard = {
  circuit: CircuitJson
  pinMap: SimulationIbisModel["ibis_pin_name_to_source_port_id"]
}

type ChipOptions = Omit<BoardOptions, "extraChip" | "extraChipAsset"> & {
  name: string
  asset: string
}

/** Make one chip and its Circuit JSON IBIS declaration. */
function InspectionChip({
  name,
  asset,
  extraPin,
  mapRails = true,
  references,
  referencePin = 1,
  modelChoice,
  componentName = "Device",
}: ChipOptions): React.JSX.Element {
  const ibisPinNameToPortLabel: Record<number, string> = { 1: "DQ" }
  if (mapRails) {
    ibisPinNameToPortLabel[2] = "VDD"
    ibisPinNameToPortLabel[3] = "VSS"
  }
  if (extraPin) ibisPinNameToPortLabel[4] = "VCLAMP"
  let ibisPinNameToReferencePortLabels:
    | Record<number, IbisPinReferences>
    | undefined
  if (references)
    ibisPinNameToReferencePortLabels = { [referencePin]: references }
  let ibisPinNameToModelName: Record<number, string> | undefined
  if (modelChoice) ibisPinNameToModelName = { 1: modelChoice }
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
        ibisComponentName={componentName}
        ibisPinNameToModelName={ibisPinNameToModelName}
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
  const { extraChip, extraChipAsset = "other.ibs", ...chipOptions } = options
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board width={10} height={10} schematicDisabled routeRemaining={false}>
      <InspectionChip name="U1" asset={deviceAsset} {...chipOptions} />
      {extraChip && <InspectionChip name="U2" asset={extraChipAsset} />}
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
  modelChoices?: readonly string[]
  voltageReferences?: string
}

/** Synthetic IBIS fixture without vendor data. */
export function inspectionIbis({
  mapping = "",
  extraPin = "",
  modelType = "Input",
  modelChoices,
  voltageReferences = "[Voltage Range] 1.2 1.2 1.2",
}: IbisOptions = {}): string {
  let pinModel = "Fast"
  let selector = ""
  if (modelChoices) {
    pinModel = "DriveSize"
    selector = `[Model Selector] DriveSize
${modelChoices.join("\n")}
[Model] Slow
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 1.2 1.2 1.2`
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
1 DQ ${pinModel}
2 VDD POWER
3 VSS GND
${extraPin}
${mapping}
${selector}
[Model] Fast
Model_type ${modelType}
C_comp 1p 1p 1p
${voltageReferences}
[End]
`
}

/** Inspect the requested source ports of the rendered chip. */
export function inspectBoardPins({
  board,
  text,
  ports,
}: {
  board: InspectionBoard
  text: string
  ports: Iterable<InspectionBoard["pinMap"][string]>
}): InspectedPins {
  return inspectPins({
    circuit: board.circuit,
    sources: { [deviceAsset]: text },
    ports: new Set(ports),
  })
}

/** Inspect the signal on pin 1 of the rendered chip. */
export function inspectedPin({
  board,
  text,
}: {
  board: InspectionBoard
  text: string
}): InspectedPin {
  const port = board.pinMap[1]
  const pin = inspectBoardPins({ board, text, ports: [port] }).get(port)
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
  references?: Record<string, IbisReferencePorts>
}): IbisReferencePorts {
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
