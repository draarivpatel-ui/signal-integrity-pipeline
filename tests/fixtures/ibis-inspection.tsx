import { Circuit, simulation } from "@tscircuit/core"
import React from "react"
import type { CircuitJson, SimulationIbisModel } from "../../src/board"

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
