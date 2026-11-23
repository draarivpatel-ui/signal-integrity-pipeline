import {
  type IbisCorner,
  type IbisDocument,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import {
  type CircuitJson,
  type CircuitJsonSnapshot,
  circuitJsonDb,
  type SimulationIbisModel,
  type SourcePortId,
} from "../../../src/board"
import type { Snapshot } from "../../../src/kernel"
import { pinModel, readInlineIbis } from "../../channel-inspector/ibis-panel"
import { bindIbisPin, editIbisText } from "./ibis-text"

export interface EmbeddedModel {
  record: Snapshot<SimulationIbisModel>
  component: string
  source?: string
  document?: IbisDocument
  error?: string
}

export interface ModelPin {
  id: string
  model: EmbeddedModel
  pin: string
  port: SourcePortId
  label: string
  name?: string
  direction?: string
  corner: IbisCorner
  signal: boolean
}

/** Load only Circuit JSON embedded sources; external references stay visible by path. */
export function embeddedModels(circuit: CircuitJsonSnapshot): EmbeddedModel[] {
  const db = circuitJsonDb(circuit)
  return db.simulation_ibis_model.list().map((record) => {
    const component =
      db.source_component.get(record.source_component_id)?.name ??
      record.source_component_id
    try {
      const source = readInlineIbis(record.ibis_model_asset.url)
      if (source)
        return { record, component, source, document: parseIbis(source) }
      return {
        record,
        component,
        error: "This model references an external IBIS file.",
      }
    } catch (cause) {
      return { record, component, error: (cause as Error).message }
    }
  })
}

/** Identify the engineering corner encoded by a pin-specific clone. */
function pinCorner(name?: string): IbisCorner {
  if (name?.endsWith("__minimum")) return "minimum"
  if (name?.endsWith("__maximum")) return "maximum"
  return "typical"
}

/** List pins and their actual declared buffers, keeping non-signal pins inspectable. */
export function modelPins({
  circuit,
  models,
}: {
  circuit: CircuitJsonSnapshot
  models: EmbeddedModel[]
}): ModelPin[] {
  const db = circuitJsonDb(circuit)
  return models.flatMap((model) =>
    Object.entries(model.record.ibis_pin_name_to_source_port_id).map(
      ([pin, port]): ModelPin => {
        const name = pinModel({
          model: model.record,
          document: model.document,
          pin,
        })
        const signal = name
          ? !["power", "gnd", "nc"].includes(name.toLowerCase())
          : true
        let direction: string | undefined
        if (name && model.document?.modelNames.includes(name))
          direction = model.document.getBuffer(name).type
        return {
          id: `${model.record.simulation_ibis_model_id}:${pin}`,
          model,
          pin,
          port,
          label: db.source_port.get(port)?.name ?? port,
          name,
          direction,
          corner: pinCorner(name),
          signal,
        }
      },
    ),
  )
}

/** Store edited embedded content under the record's own asset key. */
function replaceModel({
  circuit,
  model,
  assignment,
  source,
}: {
  circuit: CircuitJson
  model: EmbeddedModel
  assignment?: Record<string, string>
  source: string
}): CircuitJson {
  return circuit.map((record): CircuitJson[number] => {
    if (
      record.type !== "simulation_ibis_model" ||
      record.simulation_ibis_model_id !== model.record.simulation_ibis_model_id
    )
      return record
    const suffix = `-workbench-${record.simulation_ibis_model_id}.ibs`
    const path = record.ibis_model_asset.project_relative_path
    return {
      ...record,
      ibis_pin_name_to_model_name:
        assignment ?? record.ibis_pin_name_to_model_name,
      ibis_model_asset: {
        ...record.ibis_model_asset,
        project_relative_path: path.endsWith(suffix) ? path : path + suffix,
        url: `data:text/plain,${encodeURIComponent(source)}`,
      },
    }
  })
}

/** Assign a model, optionally creating a pin-specific corner or direction variant. */
export function assignIbisModel({
  circuit,
  pin,
  name,
  corner,
  direction,
}: {
  circuit: CircuitJson
  pin: ModelPin
  name: string
  corner: IbisCorner
  direction: string
}): CircuitJson {
  const { model } = pin
  if (!model.source || !model.document || !pin.signal)
    throw new Error(model.error ?? "Choose an embedded signal buffer.")
  const originalName = name.split("__wb_")[0]
  const buffer = model.document.getBuffer(originalName)
  let chosen = originalName
  let source = model.source
  if (
    corner !== "typical" ||
    (direction && direction.toLowerCase() !== buffer.type)
  ) {
    const variant = `${originalName}__wb_${pin.pin}__${direction.toLowerCase().replaceAll("/", "_")}__${corner}`
    if (!model.document.modelNames.includes(variant))
      source = editIbisText({
        source,
        edit: { name: originalName, newName: variant, corner, direction },
      })
    chosen = variant
  }
  source = bindIbisPin({
    source,
    component: model.record.ibis_component_name,
    pin: pin.pin,
    name: chosen,
  })
  return replaceModel({
    circuit,
    model,
    source,
    assignment: {
      ...model.record.ibis_pin_name_to_model_name,
      [pin.pin]: chosen,
    },
  })
}

/** Apply numeric quick edits to one component's embedded model. */
export function tuneIbisModel({
  circuit,
  model,
  name,
  scale,
  capacitancePf,
}: {
  circuit: CircuitJson
  model: EmbeddedModel
  name: string
  scale: number
  capacitancePf?: number
}): CircuitJson {
  if (!model.source)
    throw new Error(model.error ?? "This model is not embedded.")
  return replaceModel({
    circuit,
    model,
    source: editIbisText({
      source: model.source,
      edit: { name, scale, capacitancePf },
    }),
  })
}
