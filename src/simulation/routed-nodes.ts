import {
  type CircuitJsonSnapshot,
  circuitJsonDb,
  endpointPorts,
  type LaneMapping,
  type PassiveBridge,
  type SimulationPcbDriverReceiverChannel,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
} from "../board"
import type { Snapshot } from "../kernel"
import { connectionGraph } from "./connection-paths"
import {
  cutConnections,
  physicalCutGraph,
  shortedCutPath,
  validateCutBridge,
} from "./cut-connections"
import { fail } from "./diagnostics"
import { differentialContacts } from "./differential-contacts"
import {
  type ReceiverGraphs,
  receiverBypassCuts,
  receiverGraphs,
  receiverPath,
} from "./receiver-paths"
import type { RoutedTraceCut } from "./routed-types"
import {
  type idealSourceNodes,
  type NodeGroups,
  nodeGroups,
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

/** Include the physical contacts of each graph path on one differential leg. */
function differentialLegPorts({
  sourcePortIds,
  graphs,
}: {
  sourcePortIds: SourcePortId[]
  graphs: ReceiverGraphs
}): SourcePortId[] {
  const [fromSourcePortId, ...receiverSourcePortIds] = sourcePortIds
  return [
    ...new Set([
      ...sourcePortIds,
      ...receiverSourcePortIds.flatMap((toSourcePortId) =>
        (
          receiverPath({
            graphs,
            fromSourcePortId,
            toSourcePortId,
            allowUnroutedTraces: true,
          }) ?? []
        ).flatMap(({ fromSourcePortId, toSourcePortId }) => [
          fromSourcePortId,
          toSourcePortId,
        ]),
      ),
    ]),
  ]
}

/** SPICE nodes grouped by connectivity through physical cuts. */
type SpiceNodeGroups = NodeGroups<SpiceNodeName>

/** Validate the physical contacts and routed interiors of both differential legs. */
function validateDifferentialLegs({
  channels,
  node,
  legGroups,
  graphs,
}: {
  channels: readonly Snapshot<SimulationPcbDriverReceiverChannel>[]
  node: CircuitNodes["node"]
  legGroups: SpiceNodeGroups
  graphs: ReceiverGraphs
}): void {
  const contacts = differentialContacts(channels)
  for (const {
    name,
    positiveSourcePortIds,
    negativeSourcePortIds,
  } of contacts) {
    const positivePorts = differentialLegPorts({
      sourcePortIds: positiveSourcePortIds,
      graphs,
    })
    const negativePorts = differentialLegPorts({
      sourcePortIds: negativeSourcePortIds,
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
    const fromSpiceNode = node(from)
    const toSpiceNode = node(to)
    const path = (sourceTraceIds ?? [sourceTraceId]).join(", ")
    if (fromSpiceNode === "0" || toSpiceNode === "0")
      fail(
        "channel_short",
        `${port}: endpoints ${from} and ${to} include a ground contact on routed path ${path}`,
      )
    if (fromSpiceNode === toSpiceNode)
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
  const physicalGraph = physicalCutGraph(
    connections.map(({ evidence }) => evidence),
  )
  for (const connection of connections) {
    const group = groups.get(connection.fromNodeId) ?? connection.fromNodeId
    if ((cutsByGroup.get(group) ?? 0) >= (nodesByGroup.get(group) ?? 0))
      validateCutBridge({ graph, connection, physicalGraph })
  }
}

/** Check a collapsed receiver when no ordered extracted path survived admission. */
function validateReceiverBypasses({
  channels,
  graphs,
  node,
}: {
  channels: readonly Snapshot<SimulationPcbDriverReceiverChannel>[]
  graphs: ReceiverGraphs
  node: CircuitNodes["node"]
}): void {
  const { groups } = graphs
  for (const { name, driver, receivers } of channels) {
    const drivers = endpointPorts(driver)
    if ("source_port_id" in driver) {
      const groundedSourcePortId = [
        ...drivers,
        ...receivers.flatMap(endpointPorts),
      ].find((sourcePortId) => node(sourcePortId) === "0")
      if (groundedSourcePortId !== undefined)
        fail(
          "channel_short",
          `${name}: contact ${groundedSourcePortId} is shorted to ground`,
        )
    }
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

/** The physical cuts shared by node and model contact validation. */
interface ResolvedRoutedNodes {
  nodes: CircuitNodes
  cuts: readonly RoutedTraceCut[]
}

/** Number one SPICE node per ideal group in source port order. */
function numberCircuitNodes({
  db,
  graphs,
  groundSourcePortId,
}: {
  db: ReturnType<typeof circuitJsonDb>
  graphs: ReceiverGraphs
  groundSourcePortId: SourcePortId
}): CircuitNodes {
  const { groups, splitNets } = graphs
  const names = new Map([
    [sourceGroupId({ groups, sourcePortId: groundSourcePortId }), "0"],
  ])
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
  return {
    node: createCircuitNodeLookup({ mapping, splitNets }),
    groundSourcePortId,
    mapping,
  }
}

/** Check cut endpoints and return the SPICE nodes physically joined by routed cuts. */
function validateCutEndpoints({
  cuts,
  node,
  mappingOnly,
}: {
  cuts: readonly RoutedTraceCut[]
  node: CircuitNodes["node"]
  mappingOnly: boolean
}): ReadonlySet<SpiceNodeName> {
  const routedNodes = new Set<SpiceNodeName>()
  for (const cut of cuts) {
    const fromSpiceNode = node(cut.fromSourcePortId)
    const toSpiceNode = node(cut.toSourcePortId)
    if (
      fromSpiceNode === toSpiceNode ||
      fromSpiceNode === "0" ||
      toSpiceNode === "0"
    ) {
      if (mappingOnly)
        fail(
          "channel_short",
          "Extracted endpoints are shorted by another ideal source trace or reference",
        )
      shortedCut({ cut, reason: "share an ideal node or are bound to ground" })
    }
    routedNodes.add(fromSpiceNode)
    routedNodes.add(toSpiceNode)
  }
  return routedNodes
}

/** Report a series passive bypassed at either side of a routed cut. */
function validateSeriesBridges({
  bridges,
  node,
  routedNodes,
}: {
  bridges: readonly PassiveBridge[]
  node: CircuitNodes["node"]
  routedNodes: ReadonlySet<SpiceNodeName>
}): void {
  for (const [fromSourcePortId, toSourcePortId] of bridges) {
    const fromSpiceNode = node(fromSourcePortId)
    if (
      routedNodes.has(fromSpiceNode) &&
      fromSpiceNode === node(toSourcePortId)
    )
      fail(
        "channel_short",
        `Series passive contacts ${fromSourcePortId} and ${toSourcePortId} share ideal node ${fromSpiceNode}`,
      )
  }
}

/** Resolve the physical cuts once for both node grouping and terminal validation. */
export function resolveRoutedNodes({
  circuit,
  mappings,
  routedTraceCuts,
  additionalSourceTraceIds,
  modeling,
}: CircuitNodesInput): ResolvedRoutedNodes {
  const db = circuitJsonDb(circuit)
  const cuts = routedTraceCuts ?? physicalCuts({ db, mappings })
  const channels = db.simulation_pcb_driver_receiver_channel.list()
  const groundSourcePortId = selectPort({
    circuit,
    selector: modeling.channelReference,
  }).source_port_id
  const graphs = receiverGraphs({
    db,
    circuit,
    cuts,
    channels,
    groundSourcePortId,
    additionalSourceTraceIds,
    modeling,
  })
  const nodes = numberCircuitNodes({ db, graphs, groundSourcePortId })
  validateRoutedNodes({
    cuts,
    mappings,
    graphs,
    channels,
    node: nodes.node,
    mappingOnly: routedTraceCuts === undefined,
  })
  return { nodes, cuts }
}

/** Validate physical cuts, receiver paths and passive boundaries against the partition. */
function validateRoutedNodes({
  cuts,
  mappings,
  graphs,
  channels,
  node,
  mappingOnly,
}: {
  cuts: readonly RoutedTraceCut[]
  mappings: readonly LaneMapping[]
  graphs: ReceiverGraphs
  channels: readonly Snapshot<SimulationPcbDriverReceiverChannel>[]
  node: CircuitNodes["node"]
  mappingOnly: boolean
}): void {
  const routedNodes = validateCutEndpoints({ cuts, node, mappingOnly })
  const connections = cutConnections({ cuts, node })
  const legGroups = nodeGroups(
    connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
  )
  validateDifferentialLegs({ channels, node, legGroups, graphs })
  validateReceiverPaths({ mappings, node })
  validateCutChains({ connections, groups: legGroups })
  validateReceiverBypasses({ channels, graphs, node })
  validateSeriesBridges({ bridges: graphs.seriesBridges, node, routedNodes })
}

/** Resolve one SPICE node per ideal group. */
export function circuitNodes(input: CircuitNodesInput): CircuitNodes {
  return resolveRoutedNodes(input).nodes
}
