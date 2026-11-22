import {
  type CircuitJsonSnapshot,
  circuitJsonDb,
  type LaneMapping,
  passiveBridges,
  selectPort,
  type SourcePortId,
  type SourceTraceId,
} from "../board"
import type { Snapshot } from "../kernel"
import { fail } from "./diagnostics"
import type { RoutedTraceCut } from "./routed-types"
import {
  idealSourceNodes,
  shortedCut,
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

/** The terminals of a physical cut or of a declared receiver path. */
interface ChannelEndpoints {
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  label: string
}

/** Take all physical contacts and keep driver and receiver contacts for declaration checks. */
export function channelEndpoints({
  mappings,
  routedTraceCuts = [],
}: Pick<
  CircuitNodesInput,
  "mappings" | "routedTraceCuts"
>): ChannelEndpoints[] {
  return [
    ...routedTraceCuts.map((cut) => ({ ...cut, label: cut.sourceTraceId })),
    ...mappings.map(({ from, to, port }) => ({
      fromSourcePortId: from,
      toSourcePortId: to,
      label: port,
    })),
  ]
}

/** Give mapping-only experiments their physical trace cuts. */
function physicalCuts({
  db,
  mappings,
}: {
  db: ReturnType<typeof circuitJsonDb>
  mappings: readonly LaneMapping[]
}): RoutedTraceCut[] {
  return mappings.flatMap(({ from, to, sourceTraceId, sourceTraceIds }) => {
    if (!sourceTraceIds)
      return [{ sourceTraceId, fromSourcePortId: from, toSourcePortId: to }]
    return sourceTraceIds.map((sourceTraceId) => {
      const ports =
        db.source_trace.get(sourceTraceId)?.connected_source_port_ids
      if (ports?.length !== 2)
        return fail(
          "channel_net",
          `${sourceTraceId}: expected two physical trace endpoints`,
        )
      const [fromSourcePortId, toSourcePortId] = ports
      return { sourceTraceId, fromSourcePortId, toSourcePortId }
    })
  })
}

/** Validate reachability on each differential leg before adding any passive loads. */
function validateDifferentialLegs({
  db,
  cuts,
  node,
}: {
  db: ReturnType<typeof circuitJsonDb>
  cuts: readonly RoutedTraceCut[]
  node: CircuitNodes["node"]
}): void {
  const legGroups = sourceNodeGroups(
    cuts.map((cut) => [node(cut.fromSourcePortId), node(cut.toSourcePortId)]),
  )
  for (const {
    name,
    driver,
    receivers,
  } of db.simulation_pcb_driver_receiver_channel.list()) {
    if ("source_port_id" in driver) continue
    const endpoints = [
      driver,
      ...receivers.filter((end) => "p_source_port_id" in end),
    ]
    const positive = new Map(
      endpoints.map(({ p_source_port_id: port }) => {
        const group = node(port)
        return [legGroups.get(group) ?? group, port] as const
      }),
    )
    for (const { n_source_port_id: port } of endpoints) {
      const group = node(port)
      const otherPort = positive.get(legGroups.get(group) ?? group)
      if (otherPort !== undefined || group === "0")
        fail(
          "channel_short",
          `${name}: negative contact ${port} is shorted to ${otherPort ?? "ground"}`,
        )
    }
    if ([...positive.values()].some((port) => node(port) === "0"))
      fail("channel_short", `${name}: positive leg is shorted to ground`)
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
  const node: CircuitNodes["node"] = (id) => {
    if (splitNets.has(id))
      fail(
        "channel_net",
        `${id}: extracted channel spans distinct endpoint nodes; select a physical port instead of the net`,
      )
    if (!Object.hasOwn(mapping, id))
      fail("simulation_reference", `Unknown source port/net ${id}`)
    return mapping[id]
  }
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
  for (const { from, to, sourceTraceId } of mappings) {
    if (node(from) === node(to))
      shortedCut({
        cut: { sourceTraceId, fromSourcePortId: from, toSourcePortId: to },
        reason: "share an ideal node across the routed receiver path",
      })
  }
  validateDifferentialLegs({ db, cuts, node })
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
