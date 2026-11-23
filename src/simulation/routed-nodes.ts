import {
  type CircuitJsonSnapshot,
  circuitJsonDb,
  type LaneMapping,
  passiveBridges,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
} from "../board"
import type { Snapshot } from "../kernel"
import { fail } from "./diagnostics"
import { differentialContacts } from "./differential-contacts"
import type { RoutedTraceCut } from "./routed-types"
import {
  idealSourceNodes,
  type SourceNodeGroups,
  shortedCut,
  sourceGroupId,
  sourceNodeGroups,
} from "./source-node-groups"
import type { CircuitNodes, SimulationModeling } from "./types"

/** Board, physical cuts, and source selectors for SPICE node resolution. */
export interface CircuitNodesInput {
  circuit: CircuitJsonSnapshot
  mappings: readonly LaneMapping[]
  routedTraceCuts?: readonly RoutedTraceCut[]
  additionalSourceTraceIds?: readonly SourceTraceId[]
  modeling: Snapshot<SimulationModeling>
}

/** Give mapping-only experiments their physical trace cuts. */
function physicalCuts({
  db,
  mappings,
}: {
  db: ReturnType<typeof circuitJsonDb>
  mappings: readonly LaneMapping[]
}): RoutedTraceCut[] {
  const cuts = new Map<SourceTraceId, RoutedTraceCut>()
  for (const { from, to, sourceTraceId, sourceTraceIds } of mappings) {
    if (!sourceTraceIds) {
      if (!cuts.has(sourceTraceId))
        cuts.set(sourceTraceId, {
          sourceTraceId,
          fromSourcePortId: from,
          toSourcePortId: to,
        })
      continue
    }
    for (const pathSourceTraceId of sourceTraceIds) {
      const ports =
        db.source_trace.get(pathSourceTraceId)?.connected_source_port_ids
      if (ports?.length !== 2)
        return fail(
          "channel_net",
          `${pathSourceTraceId}: expected two physical trace endpoints`,
        )
      const [fromSourcePortId, toSourcePortId] = ports
      cuts.set(pathSourceTraceId, {
        sourceTraceId: pathSourceTraceId,
        fromSourcePortId,
        toSourcePortId,
      })
    }
  }
  return [...cuts.values()]
}

/** Physical cuts indexed by their stable source trace ID. */
type CutsByTraceId = ReadonlyMap<SourceTraceId, RoutedTraceCut>

/** Include the routed interiors of the selected paths on one differential leg. */
function differentialLegPorts({
  sourcePortIds,
  mappings,
  cutsByTraceId,
}: {
  sourcePortIds: SourcePortId[]
  mappings: readonly LaneMapping[]
  cutsByTraceId: CutsByTraceId
}): SourcePortId[] {
  const [driverSourcePortId, ...receiverSourcePortIds] = sourcePortIds
  return [
    ...new Set([
      ...sourcePortIds,
      ...mappings.flatMap(({ from, to, sourceTraceId, sourceTraceIds }) => {
        if (from !== driverSourcePortId || !receiverSourcePortIds.includes(to))
          return []
        return (sourceTraceIds ?? [sourceTraceId]).flatMap((traceId) => {
          const cut = cutsByTraceId.get(traceId)
          if (!cut) return []
          return [cut.fromSourcePortId, cut.toSourcePortId]
        })
      }),
    ]),
  ]
}

/** Group SPICE nodes that are connected directly through routed copper. */
function routedNodeGroups({
  cuts,
  node,
}: {
  cuts: readonly RoutedTraceCut[]
  node: CircuitNodes["node"]
}): SourceNodeGroups {
  return sourceNodeGroups(
    cuts.map(({ fromSourcePortId, toSourcePortId }) => [
      node(fromSourcePortId),
      node(toSourcePortId),
    ]),
  )
}

/** Validate the physical contacts and routed interiors of both differential legs. */
function validateDifferentialLegs({
  db,
  cuts,
  mappings,
  node,
  legGroups,
}: {
  db: ReturnType<typeof circuitJsonDb>
  cuts: readonly RoutedTraceCut[]
  mappings: readonly LaneMapping[]
  node: CircuitNodes["node"]
  legGroups: SourceNodeGroups
}): void {
  const cutsByTraceId = new Map(cuts.map((cut) => [cut.sourceTraceId, cut]))
  const contacts = differentialContacts(
    db.simulation_pcb_driver_receiver_channel.list(),
  )
  for (const {
    name,
    positiveSourcePortIds,
    negativeSourcePortIds,
  } of contacts) {
    const positivePorts = differentialLegPorts({
      sourcePortIds: positiveSourcePortIds,
      mappings,
      cutsByTraceId,
    })
    const negativePorts = differentialLegPorts({
      sourcePortIds: negativeSourcePortIds,
      mappings,
      cutsByTraceId,
    })
    const groundedSourcePortId = [...positivePorts, ...negativePorts].find(
      (sourcePortId) => node(sourcePortId) === "0",
    )
    if (groundedSourcePortId !== undefined)
      fail(
        "channel_short",
        `${name}: contact ${groundedSourcePortId} is shorted to ground`,
      )
    const positiveGroups = new Map<string, SourcePortId>()
    const positiveNodes = new Map<string, SourcePortId>()
    for (const sourcePortId of positivePorts) {
      const sourceNodeId = node(sourcePortId)
      const sourceGroup = sourceGroupId({
        groups: legGroups,
        sourcePortId: sourceNodeId,
      })
      if (!positiveNodes.has(sourceNodeId))
        positiveNodes.set(sourceNodeId, sourcePortId)
      if (!positiveGroups.has(sourceGroup))
        positiveGroups.set(sourceGroup, sourcePortId)
    }
    // Prefer an exact ideal contact so a driver short does not name a remote receiver.
    for (const negativeSourcePortId of negativePorts) {
      const positiveSourcePortId = positiveNodes.get(node(negativeSourcePortId))
      if (positiveSourcePortId !== undefined)
        fail(
          "channel_short",
          `${name}: negative contact ${negativeSourcePortId} is shorted to ${positiveSourcePortId}`,
        )
    }
    for (const negativeSourcePortId of negativePorts) {
      const negativeGroupId = sourceGroupId({
        groups: legGroups,
        sourcePortId: node(negativeSourcePortId),
      })
      const positiveSourcePortId = positiveGroups.get(negativeGroupId)
      if (positiveSourcePortId !== undefined)
        fail(
          "channel_short",
          `${name}: negative contact ${negativeSourcePortId} is shorted to ${positiveSourcePortId} through routed cuts`,
        )
    }
  }
}

/** Create a source ID lookup over the resolved SPICE node names. */
function createCircuitNodeLookup({
  mapping,
  splitNets,
}: {
  mapping: CircuitNodes["mapping"]
  splitNets: ReturnType<typeof idealSourceNodes>["splitNets"]
}): CircuitNodes["node"] {
  /** Resolve one physical source port or named net. */
  return function node(sourceId: SourcePortId): string {
    if (splitNets.has(sourceId))
      fail(
        "channel_net",
        `${sourceId}: extracted channel spans distinct endpoint nodes; select a physical port instead of the net`,
      )
    if (!Object.hasOwn(mapping, sourceId))
      fail("simulation_reference", `Unknown source port/net ${sourceId}`)
    return mapping[sourceId]
  }
}

/** Validate mapped channel paths separately from their constituent physical traces. */
function validateReceiverPaths({
  mappings,
  node,
}: {
  mappings: readonly LaneMapping[]
  node: CircuitNodes["node"]
}): void {
  for (const { port, from, to, sourceTraceId, sourceTraceIds } of mappings) {
    const fromNode = node(from)
    const toNode = node(to)
    const path = (sourceTraceIds ?? [sourceTraceId]).join(", ")
    if (fromNode === "0" || toNode === "0")
      fail(
        "channel_short",
        `${port}: endpoints ${from} and ${to} include a ground contact on routed path ${path}`,
      )
    if (fromNode === toNode)
      fail(
        "channel_short",
        `${port}: endpoints ${from} and ${to} share an ideal node across routed path ${path}`,
      )
  }
}

/** Reject a closed chain of physical cuts, including cuts beyond declared receivers. */
function validateCutChains({
  cuts,
  node,
  groups,
}: {
  cuts: readonly RoutedTraceCut[]
  node: CircuitNodes["node"]
  groups: SourceNodeGroups
}): void {
  const nodesByGroup = new Map<string, number>()
  for (const group of groups.values())
    nodesByGroup.set(group, (nodesByGroup.get(group) ?? 0) + 1)
  const cutsByGroup = new Map<string, RoutedTraceCut[]>()
  for (const cut of cuts) {
    const group = sourceGroupId({
      groups,
      sourcePortId: node(cut.fromSourcePortId),
    })
    const groupCuts = cutsByGroup.get(group) ?? []
    groupCuts.push(cut)
    cutsByGroup.set(group, groupCuts)
  }
  for (const [group, groupCuts] of cutsByGroup) {
    if (groupCuts.length < (nodesByGroup.get(group) ?? 0)) continue
    fail(
      "channel_short",
      `Ideal connections close a path across routed cuts: ${groupCuts
        .map(
          ({ sourceTraceId, fromSourcePortId, toSourcePortId }) =>
            `${sourceTraceId} (${fromSourcePortId} to ${toSourcePortId})`,
        )
        .join(", ")}`,
    )
  }
}

/** Resolve one SPICE node per ideal group, numbering groups in source port order. */
export function circuitNodes({
  circuit,
  mappings,
  routedTraceCuts,
  additionalSourceTraceIds,
  modeling,
}: CircuitNodesInput): CircuitNodes {
  const db = circuitJsonDb(circuit)
  const cuts = routedTraceCuts ?? physicalCuts({ db, mappings })
  const { groups, splitNets } = idealSourceNodes({
    db,
    cuts,
    additionalSourceTraceIds,
  })
  const ground = selectPort({
    circuit,
    selector: modeling.channelReference,
  }).source_port_id
  const names = new Map([[groups.get(ground) ?? ground, "0"]])
  const sourceNodeIds = new Set([
    ...db.source_port.list().map((port) => port.source_port_id),
    ...db.source_net.list().map((net) => net.source_net_id),
    ...groups.keys(),
  ])
  const mapping = Object.fromEntries(
    [...sourceNodeIds].flatMap((id) => {
      if (splitNets.has(id)) return []
      const group = groups.get(id) ?? id
      const name = names.get(group) ?? `n${names.size}`
      names.set(group, name)
      return [[id, name]]
    }),
  )
  const node = createCircuitNodeLookup({ mapping, splitNets })
  const routedNodes = new Set<string>()
  for (const cut of cuts) {
    const from = node(cut.fromSourcePortId)
    const to = node(cut.toSourcePortId)
    if (from === to || from === "0" || to === "0") {
      if (!routedTraceCuts)
        fail(
          "channel_short",
          "Extracted endpoints are shorted by another ideal source trace or reference",
        )
      shortedCut({ cut, reason: "share an ideal node or are bound to ground" })
    }
    routedNodes.add(from)
    routedNodes.add(to)
  }
  const legGroups = routedNodeGroups({ cuts, node })
  validateDifferentialLegs({ db, cuts, mappings, node, legGroups })
  validateReceiverPaths({ mappings, node })
  validateCutChains({ cuts, node, groups: legGroups })
  for (const [from, to] of passiveBridges({ circuit, excluded: new Set() })) {
    const terminal = node(from)
    if (routedNodes.has(terminal) && terminal === node(to))
      fail(
        "channel_short",
        `Series passive contacts ${from} and ${to} share ideal node ${terminal}`,
      )
  }
  return { node, groundSourcePortId: ground, mapping }
}
