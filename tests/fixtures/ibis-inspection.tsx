import { Circuit, simulation } from "@tscircuit/core"
import React from "react"
import type { CircuitJson, SimulationIbisModel } from "../../src/board"

export const deviceAsset = "device.ibs"
const pinLabels = { pin1: "DQ", pin2: "VDD", pin3: "VSS", pin4: "VCLAMP" }
const powerPins = { 1: "DQ", 2: "VDD", 3: "VSS" }

type BoardOptions = {
  extraPin?: boolean
  powerClamp?: string
}

type InspectionBoard = {
  circuit: CircuitJson
  pinMap: SimulationIbisModel["ibis_pin_name_to_source_port_id"]
}

/** Render a chip bound to synthetic IBIS text, with an optional fourth mapped pin. */
export async function ibisInspectionBoard(
  options: BoardOptions = {},
): Promise<InspectionBoard> {
  const { extraPin, powerClamp } = options
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board width={10} height={10} schematicDisabled routeRemaining={false}>
      <chip
        name="U1"
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
        componentRef=".U1"
        ibisModelAsset={{
          project_relative_path: deviceAsset,
          url: "https://example.com/device.ibs",
          mimetype: "text/plain",
        }}
        ibisComponentName="Device"
        ibisPinNameToPortLabel={
          extraPin ? { ...powerPins, 4: "VCLAMP" } : powerPins
        }
        ibisPinNameToReferencePortLabels={
          powerClamp ? { 1: { powerClamp } } : undefined
        }
      />
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
  const references = referenceOnly
    ? `[Pullup Reference] 1.2 1.2 1.2
[Pulldown Reference] 0 0 0
[POWER Clamp Reference] 1.2 1.2 1.2
[GND Clamp Reference] 0 0 0`
    : "[Voltage Range] 1.2 1.2 1.2"
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
