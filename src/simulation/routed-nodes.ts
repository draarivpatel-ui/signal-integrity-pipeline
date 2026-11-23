import {
  type CircuitJsonSnapshot,
  circuitJsonDb,
  endpointPorts,
  type LaneMapping,
  passiveBridges,
  type SimulationPcbDriverReceiverChannel,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
} from "../board"
import type { Snapshot } from "../kernel"
import { connectionGraph } from "./connection-paths"
import {
  cutConnections,
  shortedCutPath,
  validateCutBridge,
} from "./cut-connections"
import { fail } from "./diagnostics"
import { differentialContacts } from "./differential-contacts"
import {
  receiverBypassCuts,
  receiverGraphs,
  receiverPath,
} from "./receiver-paths"
import type { RoutedTraceCut } from "./routed-types"
import {
  idealSourceNodes,
  type NodeGroups,
  nodeGroups,
  type SourceNodeGroups,
  type SourceNodeId,
  shortedCut,
  sourceGroupId,
} from "./source-node-groups"
import type { CircuitNodes, SimulationModeling, SpiceNodeName } from "./types"

/** Board, physical cuts, and source selectors for SPICE node resolution. */
export interface CircuitNodesInput {
  circuit: CircuitJsonSnapshot
  mappings: readonly LaneMapping[]
  routedTraceCuts?: readonly RoutedTraceCut[]
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
  for (const { sourceTraceId, sourceTraceIds } of mappings) {
    for (const pathSourceTraceId of sourceTraceIds ?? [sourceTraceId]) {
      if (cuts.has(pathSourceTraceId)) continue
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
  graphs,
}: {
  sourcePortIds: SourcePortId[]
  mappings: readonly LaneMapping[]
  cutsByTraceId: CutsByTraceId
  graphs: ReturnType<typeof receiverGraphs>
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
      ...receiverSourcePortIds.flatMap((toSourcePortId) => {
        const path = receiverPath({
          graphs,
          fromSourcePortId: driverSourcePortId,
          toSourcePortId,
          allowUnroutedTraces: true,
        })
        return (path ?? []).flatMap(({ fromSourcePortId, toSourcePortId }) => [
          fromSourcePortId,
          toSourcePortId,
        ])
      }),
    ]),
  ]
}

/** SPICE nodes grouped by connectivity through physical cuts. */
type SpiceNodeGroups = NodeGroups<SpiceNodeName>

/** Validate the physical contacts and routed interiors of both differential legs. */
function validateDifferentialLegs({
  db,
  cuts,
  mappings,
  node,
  legGroups,
  graphs,
}: {
  db: ReturnType<typeof circuitJsonDb>
  cuts: readonly RoutedTraceCut[]
  mappings: readonly LaneMapping[]
  node: CircuitNodes["node"]
  legGroups: SpiceNodeGroups
  graphs: ReturnType<typeof receiverGraphs>
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
      graphs,
    })
    const negativePorts = differentialLegPorts({
      sourcePortIds: negativeSourcePortIds,
      mappings,
      cutsByTraceId,
      graphs,
    })
    const groundedSourcePortId = [...positivePorts, ...negativePorts].find(
      (sourcePortId) => node(sourcePortId) === "0",
    )
    if (groundedSourcePortId !== undefined)
      fail(
        "channel_short",
        `${name}: contact ${groundedSourcePortId} is shorted to ground`,
      )
    const positiveGroups = new Map<SpiceNodeName, SourcePortId>()
    const positiveNodes = new Map<SpiceNodeName, SourcePortId>()
    for (const sourcePortId of positivePorts) {
      const spiceNode = node(sourcePortId)
      const spiceGroup = legGroups.get(spiceNode) ?? spiceNode
      if (!positiveNodes.has(spiceNode))
        positiveNodes.set(spiceNode, sourcePortId)
      if (!positiveGroups.has(spiceGroup))
        positiveGroups.set(spiceGroup, sourcePortId)
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
      const spiceNode = node(negativeSourcePortId)
      const spiceGroup = legGroups.get(spiceNode) ?? spiceNode
      const positiveSourcePortId = positiveGroups.get(spiceGroup)
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
  return function node(sourceId: SourceNodeId): SpiceNodeName {
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
  connections,
  groups,
}: {
  connections: ReturnType<typeof cutConnections<SpiceNodeName>>
  groups: SpiceNodeGroups
}): void {
  const nodesByGroup = new Map<SpiceNodeName, number>()
  const cutsByGroup = new Map<SpiceNodeName, number>()
  for (const group of groups.values())
    nodesByGroup.set(group, (nodesByGroup.get(group) ?? 0) + 1)
  for (const { fromNodeId } of connections) {
    const group = groups.get(fromNodeId) ?? fromNodeId
    cutsByGroup.set(group, (cutsByGroup.get(group) ?? 0) + 1)
  }
  const graph = connectionGraph(connections)
  for (const connection of connections) {
    const group = groups.get(connection.fromNodeId) ?? connection.fromNodeId
    if ((cutsByGroup.get(group) ?? 0) >= (nodesByGroup.get(group) ?? 0))
      validateCutBridge({ graph, connection })
  }
}

/** Check a collapsed receiver when no ordered extracted path survived admission. */
function validateReceiverBypasses({
  channels,
  graphs,
  groups,
}: {
  channels: readonly Snapshot<SimulationPcbDriverReceiverChannel>[]
  graphs: ReturnType<typeof receiverGraphs>
  groups: SourceNodeGroups
}): void {
  for (const { driver, receivers } of channels) {
    const drivers = endpointPorts(driver)
    for (const receiver of receivers) {
      for (const [leg, toSourcePortId] of endpointPorts(receiver).entries()) {
        const fromSourcePortId = drivers[leg]
        if (
          sourceGroupId({ groups, sourcePortId: fromSourcePortId }) !==
          sourceGroupId({ groups, sourcePortId: toSourcePortId })
        )
          continue
        const cuts = receiverBypassCuts({
          graphs,
          sourcePortId: fromSourcePortId,
        })
        if (cuts.length) shortedCutPath(cuts)
      }
    }
  }
}

/** Resolve one SPICE node per ideal group, numbering groups in source port order. */
export function circuitNodes({
  circuit,
  mappings,
  routedTraceCuts,
  modeling,
}: CircuitNodesInput): CircuitNodes {
  const db = circuitJsonDb(circuit)
  const cuts = routedTraceCuts ?? physicalCuts({ db, mappings })
  const { groups, splitNets } = idealSourceNodes({
    db,
    cuts,
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
  const mapping = Object.freeze(
    Object.fromEntries(
      [...sourceNodeIds].flatMap((id) => {
        if (splitNets.has(id)) return []
        const group = groups.get(id) ?? id
        const name = names.get(group) ?? `n${names.size}`
        names.set(group, name)
        return [[id, name]]
      }),
    ),
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
  const connections = cutConnections({ cuts, node })
  const legGroups = nodeGroups(
    connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
  )
  const bridges = passiveBridges({ circuit, excluded: new Set() })
  const channels = db.simulation_pcb_driver_receiver_channel.list()
  const graphs = receiverGraphs({ cuts, bridges, groups, channels })
  validateDifferentialLegs({ db, cuts, mappings, node, legGroups, graphs })
  validateReceiverPaths({ mappings, node })
  validateCutChains({ connections, groups: legGroups })
  validateReceiverBypasses({ channels, graphs, groups })
  for (const [from, to] of bridges) {
    const terminal = node(from)
    if (routedNodes.has(terminal) && terminal === node(to))
      fail(
        "channel_short",
        `Series passive contacts ${from} and ${to} share ideal node ${terminal}`,
      )
  }
  return { node, groundSourcePortId: ground, mapping }
}
