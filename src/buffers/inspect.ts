import {
  type IbisBuffer,
  type IbisComponent,
  type IbisDocument,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import type { CircuitJson, SimulationIbisModel, SourcePortId } from "../board"
import { loadModelSource } from "./source"
import type { IbisSources } from "./types"

export interface InspectedPin {
  port: SourcePortId
  pin: string
  model: SimulationIbisModel
  component: IbisComponent
  document: IbisDocument
  buffer: IbisBuffer
  text: string
  ground: SourcePortId
  power: SourcePortId
}
/** Typical IBIS reference voltages for the pullup, pulldown and clamp tables. */
export type ReferenceVoltages = Record<
  "pullup" | "pulldown" | "powerClamp" | "groundClamp",
  number
>

/** Selected ideal reference voltages, including the vendor's explicit overrides. */
export function referenceVoltages(buffer: IbisBuffer): ReferenceVoltages {
  const ranges = {
    pullup: buffer.pullupReference ?? buffer.voltage,
    pulldown: buffer.pulldownReference ?? [0, 0, 0],
    powerClamp: buffer.powerClampReference ?? buffer.voltage,
    groundClamp: buffer.groundClampReference ?? [0, 0, 0],
  }
  return Object.fromEntries(
    Object.entries(ranges).map(([role, range]) => {
      const voltage = range[0]
      if (voltage === null || voltage === undefined)
        throw new Error(`${buffer.name}: missing typical ${role} voltage`)
      return [role, voltage]
    }),
  ) as ReferenceVoltages
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
  const scales: Record<string, number> = {
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
  return Number(text.slice(0, end)) * (scales[text[end]] ?? 1)
}
/** Resolve a vendor rail by [Pin Mapping], or a unique POWER/GND pin. */
function referenceRail(
  {
    model,
    component,
    pin,
    port,
  }: Pick<InspectedPin, "model" | "component" | "pin" | "port">,
  role: "ground" | "power",
): SourcePortId {
  const refs = model.ibis_pin_name_to_reference_source_port_ids?.[pin]
  const buses = component.pinMapping[pin]
  let explicit =
    refs?.pullup_reference_source_port_id ??
    refs?.power_clamp_reference_source_port_id
  let bus = buses?.pullup
  let railModel = "power"
  if (role === "ground") {
    explicit =
      refs?.pulldown_reference_source_port_id ??
      refs?.ground_clamp_reference_source_port_id
    bus = buses?.pulldown
    railModel = "gnd"
  }
  if (explicit) return explicit
  const candidates = Object.entries(component.pins).flatMap(
    ([id, candidate]) => {
      if (bus && candidate.signal !== bus) return []
      if (!bus && candidate.model.toLowerCase() !== railModel) return []
      const sourcePortId = model.ibis_pin_name_to_source_port_id[id]
      if (!sourcePortId) return []
      return [sourcePortId]
    },
  )
  if (candidates.length !== 1)
    throw new Error(
      `${port}: IBIS ${role} reference is ambiguous; provide the chip's reference mapping`,
    )
  return candidates[0]
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
      const physical = component.pins[pin]
      if (!physical)
        throw new Error(`${port}: physical IBIS pin ${pin} is missing`)
      if (["power", "gnd", "nc"].includes(physical.model.toLowerCase()))
        continue
      const choices = document.selectors[physical.model] ?? [physical.model]
      let name = model.ibis_pin_name_to_model_name?.[pin]
      if (name == null && choices.length === 1) name = choices[0]
      if (!name || !choices.includes(name))
        throw new Error(
          `${port}: choose an IBIS model from ${choices.join(", ")}`,
        )
      if (pins.has(port))
        throw new Error(`${port}: more than one IBIS pin binding`)
      pins.set(port, {
        port,
        pin,
        model,
        component,
        document,
        buffer: document.getBuffer(name),
        text,
        ground: referenceRail({ model, component, pin, port }, "ground"),
        power: referenceRail({ model, component, pin, port }, "power"),
      })
    }
  }
  return pins
}
/** Index after the whitespace starting at the given offset. */
function skipIbisWhitespace(text: string, start: number): number {
  while (text[start]?.trim() === "") start++
  return start
}

/** Index after the non-whitespace token starting at the given offset. */
function ibisTokenEnd(text: string, start: number): number {
  while (start < text.length && text[start].trim() !== "") start++
  return start
}

/** Yield model bodies between line-start [Model] headers and their separating whitespace. */
function* ibisModelSections(text: string): Generator<string> {
  const keyword = "[model]"
  let sectionStart: number | undefined
  for (let start = 0; start < text.length; start++) {
    if (start > 0 && !"\r\n\u2028\u2029".includes(text[start - 1])) continue
    const header = skipIbisWhitespace(text, start)
    const keywordEnd = header + keyword.length
    if (
      text.slice(header, keywordEnd).toLowerCase() !== keyword ||
      text[keywordEnd]?.trim() !== ""
    ) {
      start = header
      continue
    }
    if (sectionStart !== undefined) yield text.slice(sectionStart, start)
    sectionStart = skipIbisWhitespace(text, keywordEnd)
    start = sectionStart - 1
  }
  if (sectionStart !== undefined) yield text.slice(sectionStart)
}

/** Exact [Model] body, retaining vendor waveform and ramp subsections. */
export function modelText(pin: InspectedPin): string {
  const modelName = pin.buffer.name.toLowerCase()
  for (const section of ibisModelSections(pin.text)) {
    const name = section.slice(0, ibisTokenEnd(section, 0)).toLowerCase()
    if (name !== modelName) continue
    if (section) return section
    break
  }
  throw new Error(`IBIS model body ${pin.buffer.name} missing`)
}
/** First interpolated crossing of a measured edge voltage. */
function edgeCrossing(
  samples: readonly (readonly [number, number])[],
  target: number,
): number | undefined {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if ((a[1] - target) * (b[1] - target) <= 0 && a[1] !== b[1])
      return a[0] + ((target - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
  }
  return undefined
}

/** Read the first dV/dt value from a rising or falling IBIS ramp row. */
function rampRatioToken(line: string): string | undefined {
  const start = skipIbisWhitespace(line, 0)
  const tag = line.slice(start, start + "dv/dt_r".length).toLowerCase()
  if (tag !== "dv/dt_r" && tag !== "dv/dt_f") return undefined
  const valueStart = skipIbisWhitespace(line, ibisTokenEnd(line, start))
  if (valueStart === line.length) return undefined
  return line.slice(valueStart, ibisTokenEnd(line, valueStart))
}

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
    if (Math.abs(last - first) < 1e-6) continue
    const a = edgeCrossing(samples, first + (last - first) * 0.1)
    const b = edgeCrossing(samples, first + (last - first) * 0.9)
    if (a !== undefined && b !== undefined && b > a) edges.push(b - a)
  }
  if (!edges.length) {
    for (const line of modelText(pin).replaceAll("\r\n", "\n").split("\n")) {
      const token = rampRatioToken(line)
      if (!token || token === "NA") continue
      const [dv, dt] = token.split("/")
      const edge =
        (ibisNumber(dt) * 0.8 * pin.buffer.voltage[0]!) / ibisNumber(dv)
      if (edge > 0 && Number.isFinite(edge)) edges.push(edge)
    }
  }
  if (!edges.length)
    throw new Error(`${pin.port}: IBIS edge rate missing at the typical corner`)
  return Math.min(...edges)
}
/** Whether an IBIS pin model can drive, receive or be disabled. */
type PinCapabilities = { drive: boolean; receive: boolean; disable: boolean }

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
