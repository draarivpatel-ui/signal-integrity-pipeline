import {
  type IbisBuffer,
  type IbisComponent,
  type IbisConversionMetadata,
  type IbisDocument,
  ibisNumber,
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
  pin: string
  /** Circuit JSON model declaration for the chip. */
  model: SimulationIbisModel
  component: IbisComponent
  document: IbisDocument
  buffer: IbisBuffer
  /** Raw IBIS file text. */
  text: string
  /** Source ports of the separate IBIS reference rails. */
  references: ReferencePorts
}
/** Typical IBIS reference voltages for the pullup, pulldown and clamp tables. */
export type ReferenceVoltages = Record<
  "pullup" | "pulldown" | "powerClamp" | "groundClamp",
  number
>

/** Ground reference at 0 V for the typical, minimum and maximum corners. */
const GROUND_VOLTAGE_RANGE = [0, 0, 0] as const

/** Reads the typical corner of one model reference range. */
function typicalReferenceVoltage({
  range,
  name,
  role,
}: {
  range: Readonly<IbisBuffer["voltage"]>
  name: string
  role: keyof ReferenceVoltages
}): number {
  const voltage = range[0]
  if (voltage === null || voltage === undefined)
    throw new Error(`${name}: missing typical ${role} voltage`)
  return voltage
}

/** Selected ideal reference voltages, including the vendor's explicit overrides. */
export function referenceVoltages(buffer: IbisBuffer): ReferenceVoltages {
  const ranges = {
    pullup: buffer.pullupReference ?? buffer.voltage,
    pulldown: buffer.pulldownReference ?? GROUND_VOLTAGE_RANGE,
    powerClamp: buffer.powerClampReference ?? buffer.voltage,
    groundClamp: buffer.groundClampReference ?? GROUND_VOLTAGE_RANGE,
  }
  const { name } = buffer
  return {
    pullup: typicalReferenceVoltage({
      range: ranges.pullup,
      name,
      role: "pullup",
    }),
    pulldown: typicalReferenceVoltage({
      range: ranges.pulldown,
      name,
      role: "pulldown",
    }),
    powerClamp: typicalReferenceVoltage({
      range: ranges.powerClamp,
      name,
      role: "powerClamp",
    }),
    groundClamp: typicalReferenceVoltage({
      range: ranges.groundClamp,
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
  return [...candidates][0]
}

/** Clamp roles share the drive rails when the model names no separate clamp port or bus. */
function referenceRails(binding: PinBinding): ReferencePorts {
  const { model, component, pin } = binding
  const explicit = model.ibis_pin_name_to_reference_source_port_ids?.[pin]
  const buses = component.pinMapping[pin]
  const pullup = referenceRail({ binding, role: "pullup" })
  const pulldown = referenceRail({ binding, role: "pulldown" })
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

  const choices = selectors[physical.model] ?? [physical.model]
  let name = model.ibis_pin_name_to_model_name?.[pin]
  if (name == null && choices.length === 1) name = choices[0]
  if (!name || !choices.includes(name))
    throw new Error(`${port}: choose an IBIS model from ${choices.join(", ")}`)
  return name
}

/** Resolves the selected buffer and its reference ports. */
function inspectedPin({
  binding,
  document,
  text,
  name,
}: {
  binding: PinBinding
  document: IbisDocument
  text: string
  name: string
}): InspectedPin {
  const buffer = document.getBuffer(name)
  return {
    ...binding,
    document,
    buffer,
    text,
    references: referenceRails(binding),
  }
}

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
      const inspected = inspectedPin({ binding, document, text, name })
      pins.set(port, inspected)
    }
  }
  return pins
}
/**
 * The pinned parser does not expose Ramp data. Read only the typical rows in the exact selected model's Ramp section.
 */
function* rampRatioTokens(pin: InspectedPin): Generator<string> {
  let selected = false
  let inRamp = false
  for (const raw of pin.text.split("\n")) {
    const line = raw.split("|", 1)[0].trim()
    if (line.startsWith("[")) {
      const end = line.indexOf("]")
      const keyword = line
        .slice(1, end)
        .trim()
        .toLowerCase()
        .replaceAll("_", " ")
      if (keyword === "model") {
        if (selected) return
        selected = line.slice(end + 1).trim() === pin.buffer.name
      }
      if (
        selected &&
        ["component", "model selector", "define package model", "end"].includes(
          keyword,
        )
      )
        return
      inRamp = selected && keyword === "ramp"
      continue
    }
    if (!inRamp) continue
    const [key, value] = line
      .replaceAll("\t", " ")
      .replaceAll("=", " ")
      .split(" ")
      .filter(Boolean)
    const tag = key?.toLowerCase()
    if (value && (tag === "dv/dt_r" || tag === "dv/dt_f")) yield value
  }
}
/** Time and typical voltage at one point on an IBIS waveform. */
type WaveformSample = readonly [timeSeconds: number, voltage: number]

/** First interpolated crossing of a measured edge voltage, in seconds. */
function edgeCrossingSeconds({
  samples,
  target,
}: {
  samples: readonly WaveformSample[]
  target: number
}): number | undefined {
  for (let i = 1; i < samples.length; i++) {
    const [startSeconds, startVoltage] = samples[i - 1]
    const [endSeconds, endVoltage] = samples[i]
    const crossesTarget = (startVoltage - target) * (endVoltage - target) <= 0
    if (!crossesTarget || startVoltage === endVoltage) continue

    const voltageChange = endVoltage - startVoltage
    const elapsedSeconds = endSeconds - startSeconds
    return (
      startSeconds + ((target - startVoltage) * elapsedSeconds) / voltageChange
    )
  }
  return undefined
}

/** Measure an edge from 10% to 90% of its voltage swing. */
const EDGE_START_FRACTION = 0.1
const EDGE_END_FRACTION = 0.9
/** For a linear edge, 10–90% spans 80% of the swing and the IBIS ramp spans 20–80% (60%). */
const RAMP_TO_EDGE_DURATION = 4 / 3
/** A swing smaller than one microvolt is too flat to measure an edge. */
const FLAT_WAVEFORM_TOLERANCE_VOLTS = 1e-6

/** An interpolated crossing requires at least two points. */
const MIN_EDGE_SAMPLES = 2

/** Fastest measured 10–90% output edge at the typical corner, or the [Ramp] dV/dt. */
export function edgeSeconds(pin: InspectedPin): number {
  const durationsSeconds: number[] = []
  for (const waveform of pin.buffer.waveforms) {
    const samples = waveform.data
      .filter((row) => row[1] !== null)
      .map((row): WaveformSample => [row[0], row[1]!])
    if (samples.length < MIN_EDGE_SAMPLES) continue
    const first = samples[0][1]
    const last = samples.at(-1)![1]
    const swing = last - first
    if (Math.abs(swing) < FLAT_WAVEFORM_TOLERANCE_VOLTS) continue

    const startSeconds = edgeCrossingSeconds({
      samples,
      target: first + swing * EDGE_START_FRACTION,
    })
    const endSeconds = edgeCrossingSeconds({
      samples,
      target: first + swing * EDGE_END_FRACTION,
    })
    if (
      startSeconds === undefined ||
      endSeconds === undefined ||
      !(endSeconds > startSeconds)
    )
      continue
    durationsSeconds.push(endSeconds - startSeconds)
  }
  if (!durationsSeconds.length) {
    for (const token of rampRatioTokens(pin)) {
      const [voltageToken, timeToken] = token.split("/")
      if (!voltageToken || !timeToken) continue
      const voltage = ibisNumber(voltageToken)
      const rampSeconds = ibisNumber(timeToken)
      if (
        voltage === null ||
        voltage <= 0 ||
        rampSeconds === null ||
        rampSeconds <= 0
      )
        continue
      const edgeSeconds = rampSeconds * RAMP_TO_EDGE_DURATION
      if (Number.isFinite(edgeSeconds)) durationsSeconds.push(edgeSeconds)
    }
  }
  if (!durationsSeconds.length)
    throw new Error(`${pin.port}: IBIS edge rate missing at the typical corner`)
  return Math.min(...durationsSeconds)
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
