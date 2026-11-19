import {
  type IbisBuffer,
  type IbisComponent,
  type IbisConversionMetadata,
  type IbisDocument,
  type IbisPackagePin,
  type IbisRange,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import type { CircuitJson, SimulationIbisModel, SourcePortId } from "../board"
import { loadModelSource } from "./source"
import type { IbisSources } from "./types"

/** The selected IBIS model, pin binding and rails for one source port. */
export interface InspectedPin {
  /** Circuit JSON source port bound to this pin. */
  port: SourcePortId
  /** Physical pin name in the IBIS component. */
  pin: IbisPackagePin["name"]
  /** Circuit JSON model declaration for the chip. */
  model: SimulationIbisModel
  /** Parsed IBIS component that owns the physical pin. */
  component: IbisComponent
  /** Parsed IBIS document containing the component and its models. */
  document: IbisDocument
  /** Selected IBIS buffer model for the physical pin. */
  buffer: IbisBuffer
  /** Source ports of the separate IBIS reference rails. */
  references: ReferencePorts
}
/** Typical IBIS reference voltages for the pullup, pulldown and clamp tables. */
export type ReferenceVoltages = Record<
  "pullup" | "pulldown" | "powerClamp" | "groundClamp",
  number
>

/** Default pulldown and ground clamp reference voltage in IBIS 7.2 §6.1. */
const GROUND_REFERENCE_VOLTS = 0

/** Reads the typical corner of one model reference range. */
function typicalReferenceVoltage({
  range,
  name,
  role,
}: {
  range: IbisRange | typeof GROUND_REFERENCE_VOLTS
  name: string
  role: keyof ReferenceVoltages
}): number {
  if (typeof range === "number") return range
  const [typicalVoltage] = range
  if (typicalVoltage == null)
    throw new Error(`${name}: missing typical ${role} voltage`)
  return typicalVoltage
}

/** Selected ideal reference voltages, including the vendor's explicit overrides. */
export function referenceVoltages(buffer: IbisBuffer): ReferenceVoltages {
  const { name } = buffer
  // IBIS 7.2 §6.1 defines [Voltage Range] and 0 V as the default references.
  return {
    pullup: typicalReferenceVoltage({
      range: buffer.pullupReference ?? buffer.voltage,
      name,
      role: "pullup",
    }),
    pulldown: typicalReferenceVoltage({
      range: buffer.pulldownReference ?? GROUND_REFERENCE_VOLTS,
      name,
      role: "pulldown",
    }),
    powerClamp: typicalReferenceVoltage({
      range: buffer.powerClampReference ?? buffer.voltage,
      name,
      role: "powerClamp",
    }),
    groundClamp: typicalReferenceVoltage({
      range: buffer.groundClampReference ?? GROUND_REFERENCE_VOLTS,
      name,
      role: "groundClamp",
    }),
  }
}
/** A physical IBIS pin and the Circuit JSON port that uses it. */
type PinBinding = Pick<InspectedPin, "port" | "pin" | "model" | "component">

/** Converter role names mapped to their source port IDs. */
type ReferencePorts = IbisConversionMetadata["pins"][number]["references"]

/** The Circuit JSON reference field corresponding to each converter role. */
const REFERENCE_PORT_IDS = {
  pullup: "pullup_reference_source_port_id",
  pulldown: "pulldown_reference_source_port_id",
  powerClamp: "power_clamp_reference_source_port_id",
  groundClamp: "ground_clamp_reference_source_port_id",
  external: "external_reference_source_port_id",
} as const

/** Matches the converter's rail inference for a single reference role. */
function referenceRail({
  binding,
  role,
}: {
  binding: PinBinding
  role: keyof ReferencePorts
}): SourcePortId {
  const { model, component, pin, port } = binding
  const explicit =
    model.ibis_pin_name_to_reference_source_port_ids?.[pin]?.[
      REFERENCE_PORT_IDS[role]
    ]
  if (explicit) return explicit

  const bus = component.pinMapping[pin]?.[role]
  let busRole = role
  if (role === "external") busRole = "pullup"
  let railModel = "power"
  if (role === "pulldown" || role === "groundClamp") railModel = "gnd"
  const candidates = new Set<SourcePortId>()
  for (const [id, sourcePortId] of Object.entries(
    model.ibis_pin_name_to_source_port_id,
  )) {
    const candidate = component.pins[id]
    if (candidate?.model.toLowerCase() !== railModel) continue
    if (
      bus &&
      component.pinMapping[id]?.[busRole] !== bus &&
      candidate.signal !== bus &&
      id !== bus
    )
      continue
    candidates.add(sourcePortId)
  }
  if (candidates.size !== 1) {
    throw new Error(
      `${port}: IBIS ${role} reference is ambiguous; provide the chip's reference mapping`,
    )
  }
  const [referencePort] = candidates
  return referencePort
}

/** Clamp roles share the drive rails when the model names no separate clamp port or bus. */
function referenceRails(binding: PinBinding): ReferencePorts {
  const { model, component, pin } = binding
  const explicit = model.ibis_pin_name_to_reference_source_port_ids?.[pin]
  const buses = component.pinMapping[pin]
  const pullup = referenceRail({ binding, role: "pullup" })
  const pulldown = referenceRail({ binding, role: "pulldown" })
  // IBIS 7.2 §5 [Pin Mapping] assigns unmapped clamps to their drive buses.
  const references: ReferencePorts = {
    pullup,
    pulldown,
    powerClamp: pullup,
    groundClamp: pulldown,
  }
  if (explicit?.power_clamp_reference_source_port_id || buses?.powerClamp) {
    references.powerClamp = referenceRail({ binding, role: "powerClamp" })
  }
  if (explicit?.ground_clamp_reference_source_port_id || buses?.groundClamp) {
    references.groundClamp = referenceRail({ binding, role: "groundClamp" })
  }
  if (explicit?.external_reference_source_port_id || buses?.external) {
    references.external = referenceRail({ binding, role: "external" })
  }
  return references
}

/** IBIS pin assignments that do not select a signal buffer. */
const NON_SIGNAL_MODELS = ["power", "gnd", "nc"]

/** Selects a buffer for a physical signal pin; rail and unconnected pins have none. */
function selectedModelName({
  binding,
  selectors,
}: {
  binding: PinBinding
  selectors: IbisDocument["selectors"]
}): string | undefined {
  const { model, component, pin, port } = binding
  const physical = component.pins[pin]
  if (!physical) throw new Error(`${port}: physical IBIS pin ${pin} is missing`)
  if (NON_SIGNAL_MODELS.includes(physical.model.toLowerCase())) return undefined

  // IBIS 7.2 §5 [Pin] names either a [Model] or a [Model Selector].
  const choices = selectors[physical.model] ?? [physical.model]
  let name = model.ibis_pin_name_to_model_name?.[pin]
  if (name == null && choices.length === 1) name = choices[0]
  if (!name || !choices.includes(name))
    throw new Error(`${port}: choose an IBIS model from ${choices.join(", ")}`)
  return name
}

/** Circuit and assets to inspect for the requested source ports. */
type PinInspectionOptions = {
  circuit: CircuitJson
  sources: IbisSources
  ports: ReadonlySet<SourcePortId>
}

/** Inspected IBIS pins keyed by the selected source port IDs. */
type InspectedPins = Map<SourcePortId, InspectedPin>

/** Resolve selected signal ports and their reference rails, loading only their model declarations. */
export function inspectPins({
  circuit,
  sources,
  ports,
}: PinInspectionOptions): InspectedPins {
  const pins: InspectedPins = new Map()
  for (const model of circuit) {
    if (model.type !== "simulation_ibis_model") continue
    const selected = Object.entries(
      model.ibis_pin_name_to_source_port_id,
    ).filter(([, port]) => ports.has(port))
    if (!selected.length) continue

    const { text } = loadModelSource({
      model: { ...model, pipelineId: model.simulation_ibis_model_id },
      sources,
    })
    const document = parseIbis(text)
    const component = document.components[model.ibis_component_name]
    if (!component)
      throw new Error(`IBIS component ${model.ibis_component_name} is missing`)
    for (const [pin, port] of selected) {
      const binding: PinBinding = {
        port,
        pin,
        model,
        component,
      }
      const name = selectedModelName({ binding, selectors: document.selectors })
      if (name === undefined) continue
      if (pins.has(port))
        throw new Error(`${port}: more than one IBIS pin binding`)
      pins.set(port, {
        ...binding,
        document,
        buffer: document.getBuffer(name),
        references: referenceRails(binding),
      })
    }
  }
  return pins
}

/** Whether an IBIS pin model can drive, receive or be disabled. */
type PinCapabilities = {
  drive: boolean
  receive: boolean
  disable: boolean
}

/** Drive, receive and disable roles for the pinned converter’s supported IBIS model types. */
export function pinCapabilities(pin: InspectedPin): PinCapabilities {
  switch (pin.buffer.type) {
    case "input":
      return { drive: false, receive: true, disable: false }
    case "output":
      return { drive: true, receive: false, disable: false }
    case "i/o":
      return { drive: true, receive: true, disable: true }
    case "3-state":
      return { drive: true, receive: false, disable: true }
    default:
      throw new Error(
        `${pin.port}: unsupported IBIS model capability ${pin.buffer.type}`,
      )
  }
}
