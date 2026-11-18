import {
  type IbisBuffer,
  type IbisComponent,
  type IbisConversionMetadata,
  type IbisDocument,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import type { CircuitJson, SimulationIbisModel, SourcePortId } from "../board"
import { loadModelSource } from "./source"
import type { IbisSources } from "./types"

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
function typicalReferenceVoltage(
  range: Readonly<IbisBuffer["voltage"]>,
  {
    name,
    role,
  }: {
    name: string
    role: keyof ReferenceVoltages
  },
): number {
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
    pullup: typicalReferenceVoltage(ranges.pullup, { name, role: "pullup" }),
    pulldown: typicalReferenceVoltage(ranges.pulldown, {
      name,
      role: "pulldown",
    }),
    powerClamp: typicalReferenceVoltage(ranges.powerClamp, {
      name,
      role: "powerClamp",
    }),
    groundClamp: typicalReferenceVoltage(ranges.groundClamp, {
      name,
      role: "groundClamp",
    }),
  }
}
/** Index after the ASCII digits starting at the given offset. */
function ibisDigitsEnd(text: string, start: number): number {
  while (start < text.length && text[start] >= "0" && text[start] <= "9")
    start++
  return start
}

/** Skip an optional numeric sign. */
function skipIbisSign(text: string, start: number): number {
  if (text[start] === "+" || text[start] === "-") return start + 1
  return start
}

/** Multipliers for the decimal unit suffixes accepted by the IBIS reader. */
const IBIS_UNIT_SCALES: Record<string, number> = {
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
}

/** Parse a numeric IBIS token, including vendor unit suffixes. */
export function ibisNumber(token: string): number {
  const text = String(token)
  const start = skipIbisSign(text, 0)
  let end = ibisDigitsEnd(text, start)
  if (text[end] === ".") {
    const fractionEnd = ibisDigitsEnd(text, end + 1)
    if (fractionEnd > end + 1) end = fractionEnd
  }
  if (end === start) throw new Error(`Missing numeric IBIS value: ${token}`)
  if (text[end] === "e" || text[end] === "E") {
    const exponentStart = skipIbisSign(text, end + 1)
    const exponentEnd = ibisDigitsEnd(text, exponentStart)
    if (exponentEnd > exponentStart) end = exponentEnd
  }
  return Number(text.slice(0, end)) * (IBIS_UNIT_SCALES[text[end]] ?? 1)
}
/** A physical IBIS pin and the Circuit JSON port that uses it. */
type PinBinding = Pick<InspectedPin, "port" | "pin" | "model" | "component">

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
function referenceRail(
  { model, component, pin, port }: PinBinding,
  role: keyof ReferencePorts,
): SourcePortId {
  const explicit =
    model.ibis_pin_name_to_reference_source_port_ids?.[pin]?.[
      REFERENCE_PORT_IDS[role]
    ]
  if (explicit) return explicit

  const bus = component.pinMapping[pin]?.[role]
  const busRole = role === "external" ? "pullup" : role
  const railModel =
    role === "pulldown" || role === "groundClamp" ? "gnd" : "power"
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
  const pullup = referenceRail(binding, "pullup")
  const pulldown = referenceRail(binding, "pulldown")
  const powerClamp =
    explicit?.power_clamp_reference_source_port_id || buses?.powerClamp
      ? referenceRail(binding, "powerClamp")
      : pullup
  const groundClamp =
    explicit?.ground_clamp_reference_source_port_id || buses?.groundClamp
      ? referenceRail(binding, "groundClamp")
      : pulldown
  const references = { pullup, pulldown, powerClamp, groundClamp }
  if (!explicit?.external_reference_source_port_id && !buses?.external)
    return references
  return { ...references, external: referenceRail(binding, "external") }
}

/** IBIS pin assignments that do not select a signal buffer. */
const NON_SIGNAL_MODELS = ["power", "gnd", "nc"]

/** Selects a buffer for a physical signal pin; rail and unconnected pins have none. */
function selectedModelName(
  { model, component, pin, port }: PinBinding,
  selectors: IbisDocument["selectors"],
): string | undefined {
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
function inspectedPin(
  binding: PinBinding,
  {
    document,
    text,
    name,
  }: {
    document: IbisDocument
    text: string
    name: string
  },
): InspectedPin {
  const buffer = document.getBuffer(name)
  return {
    ...binding,
    document,
    buffer,
    text,
    references: referenceRails(binding),
  }
}

/** Resolve physical pins and reference rails; ambiguous mappings always fail. */
export function inspectPins(
  circuit: CircuitJson,
  sources: IbisSources,
): Map<SourcePortId, InspectedPin> {
  const pins = new Map<SourcePortId, InspectedPin>()
  for (const model of circuit.filter(
    (r) => r.type === "simulation_ibis_model",
  )) {
    const { text } = loadModelSource(
      { ...model, pipelineId: model.simulation_ibis_model_id },
      sources,
    )
    const document = parseIbis(text)
    const component = document.components[model.ibis_component_name]
    if (!component)
      throw new Error(`IBIS component ${model.ibis_component_name} is missing`)
    const mapping = model.ibis_pin_name_to_source_port_id
    for (const [pin, port] of Object.entries(mapping)) {
      const binding: PinBinding = {
        port,
        pin,
        model,
        component,
      }
      const name = selectedModelName(binding, document.selectors)
      if (name === undefined) continue
      if (pins.has(port))
        throw new Error(`${port}: more than one IBIS pin binding`)
      const inspected = inspectedPin(binding, { document, text, name })
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
/** First interpolated crossing of a measured edge voltage. */
function edgeCrossing(
  samples: readonly (readonly [number, number])[],
  target: number,
): number | undefined {
  for (let i = 1; i < samples.length; i++) {
    const [startTime, startVoltage] = samples[i - 1]
    const [endTime, endVoltage] = samples[i]
    const crossesTarget = (startVoltage - target) * (endVoltage - target) <= 0
    if (!crossesTarget || startVoltage === endVoltage) continue

    const voltageChange = endVoltage - startVoltage
    const timeChange = endTime - startTime
    return startTime + ((target - startVoltage) * timeChange) / voltageChange
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

/** Fastest measured 10–90% output edge at the typical corner, or the [Ramp] dV/dt. */
export function edgeSeconds(pin: InspectedPin): number {
  const edges: number[] = []
  for (const waveform of pin.buffer.waveforms) {
    const samples = waveform.data
      .filter((row) => row[1] !== null)
      .map((row) => [row[0], row[1]!] as const)
    if (samples.length < 2) continue
    const first = samples[0][1]
    const last = samples.at(-1)![1]
    const swing = last - first
    if (Math.abs(swing) < FLAT_WAVEFORM_TOLERANCE_VOLTS) continue

    const start = edgeCrossing(samples, first + swing * EDGE_START_FRACTION)
    const end = edgeCrossing(samples, first + swing * EDGE_END_FRACTION)
    if (start !== undefined && end !== undefined && end > start)
      edges.push(end - start)
  }
  if (!edges.length) {
    for (const token of rampRatioTokens(pin)) {
      if (token === "NA") continue
      const [dv, dt] = token.split("/")
      if (ibisNumber(dv) <= 0) continue
      const edge = ibisNumber(dt) * RAMP_TO_EDGE_DURATION
      if (edge > 0 && Number.isFinite(edge)) edges.push(edge)
    }
  }
  if (!edges.length)
    throw new Error(`${pin.port}: IBIS edge rate missing at the typical corner`)
  return Math.min(...edges)
}
/** Whether an IBIS pin model can drive, receive or be disabled. */
type PinCapabilities = {
  drive: boolean
  receive: boolean
  disable: boolean
}

/** Selected model capabilities; unsupported types cannot acquire invented receive/disable modes. */
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
    case "terminator":
      return { drive: false, receive: true, disable: false }
    default:
      throw new Error(
        `${pin.port}: unsupported IBIS model capability ${pin.buffer.type}`,
      )
  }
}
