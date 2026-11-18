// Electrical sources and SPICE namespacing for the routed deck.
import type { CircuitJson } from '../board'
import { selectPort } from '../board'
import { fail } from './diagnostics'
import type { CircuitNodes, ElectricalSources, SimulationModeling } from './types'

/** Formats a number with 17 significant digits so SPICE decks round-trip doubles exactly. */
const num = (value: number): string => Number(value.toPrecision(17)).toString()
/** Rejects any electrical input that is not a finite number (or not positive, when required) before it reaches the deck. */
const finite = (input: unknown, label: string, positive: boolean = false): number => {
  if (typeof input !== 'number' || !Number.isFinite(input) || (positive && input <= 0)) return fail('electrical_input', `${label}: explicit finite ${positive ? 'positive ' : ''}value required`)
  return input
}
/** Checks an electrical input and formats it for the deck in one step. */
const value = (input: unknown, label: string, positive: boolean = false): string => num(finite(input, label, positive))

/** The rewritten SPICE source and name of its prefixed wrapper. */
type NamespacedSpice = { source: string; wrapper: string }

/**
 * Prefixes every subcircuit name in a converter library so several IBIS models can share one deck.
 * Also returns the prefixed name of the top-level wrapper to instantiate.
 */
export function namespaceSpice(source: string, prefix: string): NamespacedSpice {
  const names: string[] = []
  for (let offset = source.indexOf('.'); offset !== -1; offset = source.indexOf('.', offset + 1)) {
    if (offset > 0 && !isSpiceLineBreak(source[offset - 1])) continue
    const keywordEnd = offset + '.subckt'.length
    if (source.slice(offset, keywordEnd).toLowerCase() !== '.subckt') continue
    const start = skipSpiceWhitespace(source, keywordEnd)
    const end = spiceTokenEnd(source, start)
    if (start === keywordEnd || start === end) continue
    names.push(source.slice(start, end))
    offset = end - 1
  }
  if (!names.length) fail('ibis_contract', 'Converter did not emit a SPICE component wrapper')

  const renamed = new Map(names.map(name => [name.toLowerCase(), `${prefix}_${name}`]))
  let output = ''
  let copied = 0
  while (copied < source.length) {
    const start = skipSpiceWhitespace(source, copied)
    const end = spiceTokenEnd(source, start)
    const token = source.slice(start, end)
    output += source.slice(copied, start) + (renamed.get(token.toLowerCase()) ?? token)
    copied = end
  }
  return { source: output, wrapper: `${prefix}_${names[0]}` }
}

/** Index after the whitespace that starts at the given offset. */
function skipSpiceWhitespace(source: string, start: number): number {
  while (source[start]?.trim() === '') start++
  return start
}

/** Index after the non-whitespace token that starts at the given offset. */
function spiceTokenEnd(source: string, start: number): number {
  while (start < source.length && source[start].trim() !== '') start++
  return start
}

/** The line breaks recognized when matching SPICE statements at the start of a line. */
function isSpiceLineBreak(char: string): boolean {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029'
}

/** Split the trimmed terminal list, preserving an empty terminal for an empty list. */
function splitSpicePins(source: string): string[] {
  if (source.length === 0) return ['']
  const pins: string[] = []
  for (let start = 0; start < source.length;) {
    const end = spiceTokenEnd(source, start)
    pins.push(source.slice(start, end))
    start = skipSpiceWhitespace(source, end)
  }
  return pins
}

/** Read terminals from the first placed subcircuit header with a name and terminal field. */
function placedSubcircuitPins(source: string): string[] | undefined {
  for (let start = source.indexOf('.'); start !== -1; start = source.indexOf('.', start + 1)) {
    if (start > 0 && !isSpiceLineBreak(source[start - 1])) continue
    let keywordEnd = start + 1
    while (isSpiceWordCharacter(source[keywordEnd])) keywordEnd++
    if (source.slice(start + 1, keywordEnd).toLowerCase() !== 'subckt') continue

    const nameStart = skipSpiceWhitespace(source, keywordEnd)
    if (nameStart === keywordEnd) continue
    const nameEnd = spiceTokenEnd(source, nameStart)
    if (nameEnd === source.length) continue

    const pinsStart = skipSpiceWhitespace(source, nameEnd)
    if (pinsStart === source.length) {
      // A spaces-only terminal field can follow the required separator.
      for (let offset = nameEnd + 1; offset < source.length; offset++) {
        if (source[offset] !== '\r' && source[offset] !== '\n') return ['']
      }
      continue
    }
    let pinsEnd = pinsStart
    while (pinsEnd < source.length && source[pinsEnd] !== '\r' && source[pinsEnd] !== '\n') pinsEnd++
    return splitSpicePins(source.slice(pinsStart, pinsEnd).trim())
  }
  return undefined
}

const unsupportedSpiceDirectives = ['include', 'lib', 'control', 'end', 'tran', 'ac', 'dc']

/** Check the ASCII letters, digits and underscore used in a directive name. */
function isSpiceWordCharacter(char: string | undefined): boolean {
  if (char === undefined) return false
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_'
}

/** Find directives and device types excluded from placed passive subcircuits. */
function hasUnsupportedPlacedSpice(source: string): boolean {
  for (let start = 0; start < source.length; start++) {
    if (start > 0 && !isSpiceLineBreak(source[start - 1])) continue
    start = skipSpiceWhitespace(source, start)
    const first = source[start]
    if (first && 'BESGWFTbesgwft'.includes(first)) return true
    if (first !== '.') continue

    let end = start + 1
    while (isSpiceWordCharacter(source[end])) end++
    const directive = source.slice(start + 1, end).toLowerCase()
    if (unsupportedSpiceDirectives.includes(directive)) return true
  }
  return false
}

/** The two terminals on a SPICE resistor or inductor line. */
type SpiceTerminalPair = [first: string, second: string]

/** Read the terminals of a resistor or inductor line that also has a separator after the second terminal. */
function dcSpiceTerminals(line: string): SpiceTerminalPair | undefined {
  const deviceStart = skipSpiceWhitespace(line, 0)
  const device = line[deviceStart]
  if (!device || !'RLrl'.includes(device)) return undefined
  const first = skipSpiceWhitespace(line, spiceTokenEnd(line, deviceStart))
  const firstEnd = spiceTokenEnd(line, first)
  const second = skipSpiceWhitespace(line, firstEnd)
  const secondEnd = spiceTokenEnd(line, second)
  if (secondEnd === line.length) return undefined
  return [line.slice(first, firstEnd), line.slice(second, secondEnd)]
}

/**
 * Turns physical voltage sources, declared supplies and selected passives into SPICE lines.
 * Fails when a source is shorted, floating or unsupported, because this backend never invents rails.
 */
export function electricalSources(circuit: CircuitJson, modeling: SimulationModeling, nodes: CircuitNodes): ElectricalSources {
  const sources: string[] = []
  const passives: string[] = []
  const activeNodes = new Set(['0'])
  const dcConnections: Array<[string, string]> = []
  const sourceBindings: ElectricalSources['sourceBindings'] = []
  const sourcePorts = circuit.filter(e => e.type === 'source_port')
  const sourceComponents = circuit.filter(e => e.type === 'source_component')
  /** Marks both nodes as part of the modeled circuit and returns them as a SPICE terminal pair. */
  const terminals = (positive: string, negative: string): string => {
    activeNodes.add(positive)
    activeNodes.add(negative)
    return `${positive} ${negative}`
  }
  for (const [i, source] of circuit.filter(e => e.type === 'simulation_voltage_source').entries()) {
    const positive = source.is_dc_source ? source.positive_source_port_id ?? source.positive_source_net_id : source.terminal1_source_port_id
    const negative = source.is_dc_source ? source.negative_source_port_id ?? source.negative_source_net_id : source.terminal2_source_port_id
    if (!positive || !negative) return fail('supply_reference', 'Voltage sources require explicit positive and negative source port/net terminals')
    const pos = nodes.node(positive)
    const neg = nodes.node(negative)
    if (pos === neg) fail('supply_short', 'Voltage source terminals resolve to the same node')
    let expression: string
    if (source.is_dc_source || !source.wave_shape) expression = value(source.voltage, 'voltage source voltage')
    else if (source.wave_shape === 'square') {
      const period = source.period === undefined ? 1 / finite(source.frequency, 'source frequency', true) : source.period / 1000
      const amplitude = finite(source.peak_to_peak_voltage ?? source.voltage, 'source amplitude')
      const low = source.peak_to_peak_voltage === undefined ? 0 : finite(source.voltage, 'source offset') - amplitude / 2
      const high = low + amplitude
      const rise = (source.rise_time ?? 0) / 1000
      const fall = (source.fall_time ?? 0) / 1000
      if (rise <= 0 || fall <= 0) fail('source_edge', 'Square voltage sources require explicit positive rise/fall times')
      expression = `PULSE(${value(low, 'source low')} ${value(high, 'source high')} ${value((source.pulse_delay ?? 0) / 1000, 'source delay')} ${value(rise, 'source rise', true)} ${value(fall, 'source fall', true)} ${value(source.pulse_width === undefined ? period * (source.duty_cycle ?? .5) : source.pulse_width / 1000, 'source width', true)} ${value(period, 'source period', true)})`
    } else return fail('source_capability', `Voltage waveform ${source.wave_shape} is unsupported by this PCB backend`)
    sources.push(`VPHYSICAL${i} ${terminals(pos, neg)} ${expression}`)
    const port = sourcePorts.find(e => e.source_port_id === positive)
    const component = sourceComponents.find(e => e.source_component_id === port?.source_component_id)
    sourceBindings.push({ name: component?.name ?? source.simulation_voltage_source_id, positiveNode: pos, negativeNode: neg })
    dcConnections.push([pos, neg])
  }
  for (const [i, source] of (modeling.supplies ?? []).entries()) {
    const pos = nodes.node(selectPort(circuit, source.positive).source_port_id)
    const neg = nodes.node(selectPort(circuit, source.negative).source_port_id)
    if (pos === neg) fail('supply_short', 'Explicit supply terminals resolve to the same node')
    sources.push(`VDECLARED${i} ${terminals(pos, neg)} ${value(source.voltageV, 'declared supply')}`)
    sourceBindings.push({ name: `modeling.supplies[${i}]`, positiveNode: pos, negativeNode: neg })
    dcConnections.push([pos, neg])
  }
  for (const [i, selection] of (modeling.passiveComponents ?? []).entries()) {
    const components = sourceComponents.filter(e => selection.sourceComponentId ? e.source_component_id === selection.sourceComponentId : e.name === selection.component)
    if (components.length !== 1) fail('passive_reference', 'Selected passive component is missing or ambiguous')
    const component = components[0]
    const ports = sourcePorts.filter(e => e.source_component_id === component.source_component_id).sort((a, b) => Number(a.pin_number) - Number(b.pin_number))
    const placed = circuit.filter(r => r.type === 'simulation_spice_subcircuit').filter(r => r.source_component_id === component.source_component_id)
    if (placed.length) {
      if (placed.length !== 1) fail('passive_capability', `${component.name}: placed SPICE model is ambiguous`)
      const model = placed[0]
      const pins = placedSubcircuitPins(model.subcircuit_source)
      if (!pins || hasUnsupportedPlacedSpice(model.subcircuit_source)) fail('passive_capability', `${component.name}: placed SPICE model is unsupported; it cannot be discarded.`)
      if (pins.some(pin => !model.spice_pin_to_source_port_map[pin])) fail('passive_capability', `${component.name}: placed SPICE model has unmapped terminals`)
      const namespaced = namespaceSpice(model.subcircuit_source, `PLACED${i}`)
      const nodesForPins = pins.map(pin => nodes.node(model.spice_pin_to_source_port_map[pin]))
      nodesForPins.forEach(node => activeNodes.add(node))
      passives.push(namespaced.source, `XPHYSICAL${i} ${nodesForPins.join(' ')} ${namespaced.wrapper}`)
      // Supported passive resistor/inductor edges determine the DC rail connectivity.
      for (const line of model.subcircuit_source.replaceAll('\r\n', '\n').split('\n')) {
        const terminals = dcSpiceTerminals(line)
        if (!terminals) continue
        const [a, b] = terminals.map(pin => pins.indexOf(pin))
        if (a >= 0 && b >= 0) dcConnections.push([nodesForPins[a], nodesForPins[b]])
      }
      continue
    }
    if (ports.length !== 2) fail('passive_capability', `${component.name}: expected two physical ports`)
    const pos = nodes.node(ports[0].source_port_id)
    const neg = nodes.node(ports[1].source_port_id)
    let kind: 'R' | 'C' | 'L'
    let amount: unknown
    let quantity: string
    switch (component.ftype) {
      case 'simple_resistor': kind = 'R'
      amount = component.resistance
      quantity = 'resistance'
      break
      case 'simple_capacitor': kind = 'C'
      amount = component.capacitance
      quantity = 'capacitance'
      break
      case 'simple_inductor': kind = 'L'
      amount = component.inductance
      quantity = 'inductance'
      break
      default: return fail('passive_capability', `${component.name}: only explicit resistor/capacitor/inductor models supported`)
    }
    passives.push(`${kind}PHYSICAL${i} ${terminals(pos, neg)} ${value(amount, `${component.name} ${quantity}`, true)}`)
    if (kind !== 'C') dcConnections.push([pos, neg])
  }
  if (!sources.length) fail('supply_missing', 'Declare physical voltage sources or explicit source-port supplies; this backend never invents VDD')
  const grounded = new Set(['0'])
  let changed = true
  while (changed) {
    changed = false
    for (const [a, b] of dcConnections) if (grounded.has(a) || grounded.has(b)) for (const node of [a, b]) if (!grounded.has(node)) {
      grounded.add(node)
      changed = true
    }
  }
  for (const source of sourceBindings) if (!grounded.has(source.positiveNode) || !grounded.has(source.negativeNode)) fail('floating_source', `${source.name}: ideal voltage source has no explicit DC connection to channelReference; wire its physical terminals to the modeled supply/reference ports`)
  return { lines: [...sources, ...passives], activeNodes, grounded, sourceBindings, scope: { voltageSources: sources.length, passiveComponents: passives.length, unselectedBoardComponents: 'Excluded from this explicitly selected channel experiment' } }
}
