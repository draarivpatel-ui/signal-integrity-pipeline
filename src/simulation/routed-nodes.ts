import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  endpointPorts,
  type LaneMapping,
  type SimulationPcbDriverReceiverChannel,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
} from "../board"
import type { Snapshot } from "../kernel"
import { cutConnections, validateChannelBridge } from "./cut-connections"
import { fail } from "./diagnostics"
import { differentialContacts } from "./differential-contacts"
import {
  type ReceiverGraphs,
  receiverGraphs,
  receiverPath,
} from "./receiver-paths"
import type { RoutedTraceCut } from "./routed-types"
import {
  type IdealSourceNodes,
  type NodeGroups,
  nodeGroups,
  type SourceNodeId,
  shortedCut,
  sourceGroupId,
} from "./source-node-groups"
import type { CircuitNodes, SimulationModeling, SpiceNodeName } from "./types"

/** Board, physical cuts, and source selectors for SPICE node resolution. */
export interface CircuitNodesInput {
  circuit: CircuitJson
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
  db: CircuitJsonUtilObjects
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
  channels: readonly SimulationPcbDriverReceiverChannel[]
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
  splitNets: IdealSourceNodes["splitNets"]
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

/** Check declared signal contacts even when a channel has no routed cuts. */
function validateSingleEndedGround({
  channels,
  node,
}: {
  channels: readonly SimulationPcbDriverReceiverChannel[]
  node: CircuitNodes["node"]
}): void {
  for (const { name, driver, receivers } of channels) {
    if (!("source_port_id" in driver)) continue
    const groundedSourcePortId = [
      driver.source_port_id,
      ...receivers.flatMap(endpointPorts),
    ].find((sourcePortId) => node(sourcePortId) === "0")
    if (groundedSourcePortId !== undefined)
      fail(
        "channel_short",
        `${name}: contact ${groundedSourcePortId} is shorted to ground`,
      )
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
  db: CircuitJsonUtilObjects
  graphs: ReceiverGraphs
  groundSourcePortId: SourcePortId
}): CircuitNodes {
  const { groups, splitNets } = graphs
  const spiceNodeNameBySourceNodeGroupId = new Map([
    [sourceGroupId({ groups, sourcePortId: groundSourcePortId }), "0"],
  ])
  const sourceNodeIds = new Set([
    ...db.source_port.list().map((port) => port.source_port_id),
    ...db.source_net.list().map((net) => net.source_net_id),
    ...groups.keys(),
  ])
  const mapping = Object.freeze(
    Object.fromEntries(
      [...sourceNodeIds].flatMap((sourceNodeId) => {
        if (splitNets.has(sourceNodeId)) return []
        const sourceNodeGroupId = groups.get(sourceNodeId) ?? sourceNodeId
        const spiceNodeName =
          spiceNodeNameBySourceNodeGroupId.get(sourceNodeGroupId) ??
          `n${spiceNodeNameBySourceNodeGroupId.size}`
        spiceNodeNameBySourceNodeGroupId.set(sourceNodeGroupId, spiceNodeName)
        return [[sourceNodeId, spiceNodeName]]
      }),
    ),
  )
  return {
    node: createCircuitNodeLookup({ mapping, splitNets }),
    groundSourcePortId,
    mapping,
  }
}

/** Reject grounded cuts and preserve the diagnostic for directly collapsed endpoints. */
function validateCutEndpoints({
  cuts,
  node,
  mappingOnly,
}: {
  cuts: readonly RoutedTraceCut[]
  node: CircuitNodes["node"]
  mappingOnly: boolean
}): void {
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
  const db = cju([...circuit])
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
  channels: readonly SimulationPcbDriverReceiverChannel[]
  node: CircuitNodes["node"]
  mappingOnly: boolean
}): void {
  validateCutEndpoints({ cuts, node, mappingOnly })
  const connections = cutConnections({ cuts, node })
  const legGroups = nodeGroups(
    connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
  )
  validateDifferentialLegs({ channels, node, legGroups, graphs })
  validateReceiverPaths({ mappings, node })
  validateSingleEndedGround({ channels, node })
  for (const connection of graphs.channelConnections)
    validateChannelBridge({
      graph: graphs.ideal,
      physicalGraph: graphs.physical,
      connection,
    })
}

/** Resolve one SPICE node per ideal group. */
export function circuitNodes(input: CircuitNodesInput): CircuitNodes {
  return resolveRoutedNodes(input).nodes
}
