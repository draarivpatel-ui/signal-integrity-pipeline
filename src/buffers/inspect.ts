import {
  cornerValue,
  type IbisBuffer,
  type IbisComponent,
  type IbisConversionMetadata,
  type IbisDocument,
  IbisError,
  type IbisPackagePin,
  type IbisRange,
  ibisNumber,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import type { CircuitJson, SimulationIbisModel, SourcePortId } from "../board"
import { fail } from "./diagnostics"
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
  /** Selected IBIS buffer model for the physical pin. */
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

/** Default pulldown and ground clamp reference voltage in IBIS 7.2 §6.1. */
const GROUND_VOLTAGE_RANGE: IbisRange = [0, 0, 0]

/** Selected ideal reference voltages, including the vendor's explicit overrides. */
export function referenceVoltages({
  buffer,
}: Pick<InspectedPin, "buffer">): ReferenceVoltages {
  // IBIS 7.2 §6.1 defines [Voltage Range] and 0 V as the default references.
  try {
    return {
      pullup: cornerValue(
        buffer.pullupReference ?? buffer.voltage,
        "typical",
        "pullup reference",
      ),
      pulldown: cornerValue(
        buffer.pulldownReference ?? GROUND_VOLTAGE_RANGE,
        "typical",
        "pulldown reference",
      ),
      powerClamp: cornerValue(
        buffer.powerClampReference ?? buffer.voltage,
        "typical",
        "power clamp reference",
      ),
      groundClamp: cornerValue(
        buffer.groundClampReference ?? GROUND_VOLTAGE_RANGE,
        "typical",
        "ground clamp reference",
      ),
    }
  } catch (error) {
    if (!(error instanceof IbisError) || error.code !== "missing_corner")
      throw error
    fail("ibis_reference_voltage_missing", `${buffer.name}: ${error.message}`)
  }
}

/** A physical IBIS pin and the Circuit JSON port that uses it. */
type PinBinding = Pick<InspectedPin, "port" | "pin" | "model" | "component">

/** Converter role names mapped to their source port IDs. */
export type ReferencePorts =
  IbisConversionMetadata["pins"][number]["references"]

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
    fail(
      "ibis_reference_ambiguous",
      `${port}: IBIS ${role} reference is ambiguous; provide the chip's reference mapping`,
    )
  }
  const [referencePort] = candidates
  return referencePort
}

/** Clamp roles share the drive rails when the model names no separate clamp port or bus. */
function referenceRails(binding: PinBinding): ReferencePorts {
  const { model, component, pin, port } = binding
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
  if (pullup === pulldown)
    fail(
      "ibis_reference_short",
      `${port}: IBIS pullup and pulldown references must differ`,
    )
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
  if (!physical)
    fail("ibis_pin_missing", `${port}: physical IBIS pin ${pin} is missing`)
  if (NON_SIGNAL_MODELS.includes(physical.model.toLowerCase())) return undefined

  // IBIS 7.2 §5 [Pin] names either a [Model] or a [Model Selector].
  const choices = selectors[physical.model] ?? [physical.model]
  let name = model.ibis_pin_name_to_model_name?.[pin]
  if (name === undefined && choices.length === 1) name = choices[0]
  if (!name || !choices.includes(name))
    fail(
      "ibis_model_choice",
      `${port}: choose an IBIS model from ${choices.join(", ")}`,
    )
  return name
}

/** Circuit and assets to inspect for the requested source ports. */
type PinInspectionOptions = {
  circuit: CircuitJson
  sources: IbisSources
  ports: ReadonlySet<SourcePortId>
}

/** Inspected IBIS pins keyed by the selected source port IDs. */
export type InspectedPins = Map<SourcePortId, InspectedPin>

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
      fail(
        "ibis_component_missing",
        `IBIS component ${model.ibis_component_name} is missing`,
      )
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
        fail("ibis_pin_bound_twice", `${port}: more than one IBIS pin binding`)
      pins.set(port, {
        ...binding,
        buffer: document.getBuffer(name),
        text,
        references: referenceRails(binding),
      })
    }
  }
  return pins
}

/** Whether an IBIS pin model can drive, receive or be disabled. */
export type PinCapabilities = {
  drive: boolean
  receive: boolean
  disable: boolean
}

/** Drive, receive and disable capabilities for the pinned converter’s supported IBIS model types. */
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
      fail(
        "ibis_capability_unsupported",
        `${pin.port}: unsupported IBIS model capability ${pin.buffer.type}`,
      )
  }
}

/** Read the typical [Ramp] ratios for this model (IBIS 7.2 §6.1). */
function* rampRatioTokens(pin: InspectedPin): Generator<string> {
  // The pinned parser accepts [Ramp] but exposes only the waveform data.
  let selected = false
  let inRamp = false
  for (const raw of pin.text.split("\n")) {
    const line = raw.split("|", 1)[0].trim()
    if (line.startsWith("[")) {
      const end = line.indexOf("]")
      const keyword = line.slice(1, end).trim().toLowerCase()
      if (keyword === "model") {
        selected = line.slice(end + 1).trim() === pin.buffer.name
      }
      inRamp = selected && keyword === "ramp"
      continue
    }
    if (!inRamp) continue
    // IBIS 7.2 §3.2 defines both spaces and tabs as whitespace.
    const [key, value] = line.replaceAll("\t", " ").split(" ").filter(Boolean)
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
    const low = Math.min(startVoltage, endVoltage)
    const high = Math.max(startVoltage, endVoltage)
    if (low === high || target < low || target > high) continue

    const voltageChange = endVoltage - startVoltage
    const elapsedSeconds = endSeconds - startSeconds
    const crossingSeconds =
      startSeconds + ((target - startVoltage) * elapsedSeconds) / voltageChange
    return crossingSeconds
  }
  return undefined
}

/** Start the edge duration measurement at 10% of the voltage swing. */
const EDGE_START_FRACTION = 0.1

/** End the edge duration measurement at 90% of the voltage swing. */
const EDGE_END_FRACTION = 0.9

/** Scale the 20–80% ramp duration to 10–90% for a linear transition. */
const RAMP_TO_EDGE_DURATION = 4 / 3

/** Fastest typical 10–90% output edge duration from a waveform or [Ramp]. */
export function edgeDurationSeconds(pin: InspectedPin): number {
  if (!pinCapabilities(pin).drive)
    fail(
      "ibis_edge_not_driving",
      `${pin.port}: input-only pin has no IBIS output edge duration`,
    )

  const durationsSeconds: number[] = []
  for (const waveform of pin.buffer.waveforms) {
    const samples: WaveformSample[] = []
    for (const [timeSeconds, typicalVoltage] of waveform.data) {
      if (typicalVoltage === null) continue
      samples.push([timeSeconds, typicalVoltage])
    }
    const first = samples[0]
    const last = samples.at(-1)
    if (!first || !last) continue
    const firstVoltage = first[1]
    const swing = last[1] - firstVoltage

    const startSeconds = edgeCrossingSeconds({
      samples,
      target: firstVoltage + swing * EDGE_START_FRACTION,
    })
    const endSeconds = edgeCrossingSeconds({
      samples,
      target: firstVoltage + swing * EDGE_END_FRACTION,
    })
    if (startSeconds === undefined || endSeconds === undefined) continue
    const durationSeconds = endSeconds - startSeconds
    if (durationSeconds > 0 && Number.isFinite(durationSeconds))
      durationsSeconds.push(durationSeconds)
  }
  if (durationsSeconds.length) return Math.min(...durationsSeconds)

  // IBIS 7.2 §6.1 requires [Ramp] for drivers and makes waveforms optional.
  for (const token of rampRatioTokens(pin)) {
    const [voltageToken, timeToken] = token.split("/")
    if (!voltageToken || !timeToken) continue
    const voltage = ibisNumber(voltageToken)
    const rampSeconds = ibisNumber(timeToken)
    if (voltage === null || voltage <= 0 || !rampSeconds || rampSeconds < 0)
      continue
    const durationSeconds = rampSeconds * RAMP_TO_EDGE_DURATION
    if (Number.isFinite(durationSeconds)) durationsSeconds.push(durationSeconds)
  }
  if (!durationsSeconds.length)
    fail(
      "ibis_edge_duration_missing",
      `${pin.port}: IBIS edge duration missing at the typical corner`,
    )
  return Math.min(...durationsSeconds)
}
