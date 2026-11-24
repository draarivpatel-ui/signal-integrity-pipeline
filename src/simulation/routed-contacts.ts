import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { LaneMapping, SourcePortId } from "../board"
import type { Snapshot } from "../kernel"
import { fail } from "./diagnostics"
import {
  hasBuiltInPassiveModel,
  passiveSelectionComponents,
  placedSubcircuitPins,
} from "./netlist"
import type { RoutedTraceCut } from "./routed-types"
import type { PipelineIbisModel, SimulationModeling } from "./types"

/** The source contact IDs and the paths or cuts that require each contact. */
type RequiredContacts = ReadonlyMap<SourcePortId, string>

/** Keep the first path or cut associated with each required physical contact. */
export function requiredContacts({
  mappings,
  cuts,
}: {
  mappings: readonly LaneMapping[]
  cuts: readonly RoutedTraceCut[]
}): RequiredContacts {
  const endpoints = new Map<SourcePortId, string>()
  for (const { from, to, port } of mappings) {
    if (!endpoints.has(from)) endpoints.set(from, port)
    if (!endpoints.has(to)) endpoints.set(to, port)
  }
  for (const { fromSourcePortId, toSourcePortId, sourceTraceId } of cuts) {
    if (!endpoints.has(fromSourcePortId))
      endpoints.set(fromSourcePortId, sourceTraceId)
    if (!endpoints.has(toSourcePortId))
      endpoints.set(toSourcePortId, sourceTraceId)
  }
  return endpoints
}

/** Find the physical ports of the passive models actually selected for the deck. */
export function passiveModelContacts({
  db,
  modeling,
}: {
  db: CircuitJsonUtilObjects
  modeling: Snapshot<SimulationModeling>
}): ReadonlySet<SourcePortId> {
  const components = db.source_component.list()
  const contacts = new Set<SourcePortId>()
  for (const selection of modeling.passiveComponents ?? []) {
    const selected = passiveSelectionComponents({ components, selection })
    if (selected.length !== 1) continue
    const [component] = selected
    const sourceComponentId = component.source_component_id
    const placed = db.simulation_spice_subcircuit.list({
      source_component_id: sourceComponentId,
    })
    if (placed.length === 1) {
      const [model] = placed
      const pins = placedSubcircuitPins(model.subcircuit_source)
      if (!pins) continue
      const terminals = pins.map(
        (pin) => model.spice_pin_to_source_port_map[pin],
      )
      if (terminals.some((sourcePortId) => !sourcePortId)) continue
      for (const sourcePortId of terminals) contacts.add(sourcePortId)
    } else if (!placed.length && hasBuiltInPassiveModel(component)) {
      const ports = db.source_port.list({
        source_component_id: sourceComponentId,
      })
      if (ports.length !== 2) continue
      for (const { source_port_id } of ports) contacts.add(source_port_id)
    }
  }
  return contacts
}

/** Every required contact needs its modeled passive terminal or one scoped IBIS run state. */
export function validateRoutedContacts({
  db,
  experimentName,
  endpoints,
  scopedModels,
  stateIds,
  passiveContacts,
}: {
  db: CircuitJsonUtilObjects
  experimentName: string
  endpoints: RequiredContacts
  scopedModels: readonly PipelineIbisModel[]
  stateIds: ReadonlySet<SourcePortId>
  passiveContacts: ReadonlySet<SourcePortId>
}): void {
  const modelsByPort = new Map<SourcePortId, number>()
  for (const model of scopedModels) {
    for (const sourcePortId of Object.values(
      model.ibis_pin_name_to_source_port_id,
    ))
      modelsByPort.set(sourcePortId, (modelsByPort.get(sourcePortId) ?? 0) + 1)
  }
  for (const [sourcePortId, label] of endpoints) {
    const bindingCount = modelsByPort.get(sourcePortId) ?? 0
    if (bindingCount === 1 && stateIds.has(sourcePortId)) continue
    if (bindingCount === 0 && passiveContacts.has(sourcePortId)) continue
    const sourcePort = db.source_port.get(sourcePortId)
    const component = db.source_component.getWhere({
      source_component_id: sourcePort?.source_component_id,
    })
    const requirement =
      "requires exactly one modeled physical pin and an explicit run state"
    let componentDetail = ""
    if (bindingCount === 0 && component)
      componentDetail = `; ${component.name} has no selected deck model for this contact`
    fail(
      "channel_model",
      `${experimentName} ${label}: endpoint ${sourcePortId} ${requirement}${componentDetail}`,
    )
  }
}
