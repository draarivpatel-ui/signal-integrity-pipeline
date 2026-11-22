import { findConnectedNetworks } from "circuit-json-to-connectivity-map"
import type { CircuitJsonDb, LaneMapping, SourcePortId } from "../board"
import { fail } from "./diagnostics"
import type { IdealRoutedJunction, RoutedTraceCut } from "./routed-types"
import type { CircuitNodes } from "./types"

/** A pair of source ports that marks the ends of an electrical cut. */
export interface ChannelEndpoints {
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  label: string
}

/** Collect physical cut contacts first and keep receiver-only contacts for declaration checks. */
export function channelEndpoints({
  mappings,
  routedTraceCuts,
}: {
  mappings: readonly LaneMapping[]
  routedTraceCuts?: readonly RoutedTraceCut[]
}): ChannelEndpoints[] {
  return [
    ...(routedTraceCuts ?? []).map((cut) => ({
      ...cut,
      label: cut.sourceTraceId,
    })),
    ...mappings.map(({ from, to, port }) => ({
      fromSourcePortId: from,
      toSourcePortId: to,
      label: port,
    })),
  ]
}

/** Require all redundant bindings of a shared net to be covered by one linear cut path. */
export function validateNamedNetCuts({
  cuts,
  members,
}: {
  cuts: readonly ChannelEndpoints[]
  members: readonly SourcePortId[]
}): void {
  const pairs = cuts.map(({ fromSourcePortId, toSourcePortId }) => [
    fromSourcePortId,
    toSourcePortId,
  ])
  const endpoints = pairs.flat()
  const ports = new Set(endpoints)
  const networks = findConnectedNetworks(pairs)
  const degrees = new Map<SourcePortId, number>()
  for (const port of endpoints) degrees.set(port, (degrees.get(port) ?? 0) + 1)
  if (
    members.some((port) => !ports.has(port)) ||
    Object.keys(networks).length !== 1 ||
    pairs.length !== ports.size - 1 ||
    [...degrees.values()].some((degree) => degree > 2)
  )
    fail(
      "channel_fanout",
      `${cuts[0].label}: shared channel net has additional ports; bind loads to an explicit endpoint`,
    )
}

/** Report a collision with a physical conductor, another channel leg or the reference. */
function channelShort(): never {
  return fail(
    "channel_short",
    "Extracted endpoints are shorted by another ideal source trace or reference",
  )
}

/** Check that two ports remain electrically separate after the cut. */
function requireDistinctNodes({
  node,
  from,
  to,
}: {
  node: CircuitNodes["node"]
  from: SourcePortId
  to: SourcePortId
}): void {
  const fromNode = node(from)
  const toNode = node(to)
  if (fromNode === toNode || fromNode === "0" || toNode === "0") channelShort()
}

/** Reject shorts across physical cuts and distinct legs while permitting identified ideal junctions. */
export function validateRoutedNodes({
  mappings,
  routedTraceCuts,
  idealRoutedJunctions = [],
  node,
  db,
}: {
  mappings: readonly LaneMapping[]
  routedTraceCuts?: readonly RoutedTraceCut[]
  idealRoutedJunctions?: readonly IdealRoutedJunction[]
  node: CircuitNodes["node"]
  db: CircuitJsonDb
}): void {
  for (const { from, to } of mappings) requireDistinctNodes({ node, from, to })
  let endpoints = new Set(mappings.flatMap(({ from, to }) => [from, to]))
  if (routedTraceCuts) {
    endpoints = new Set(
      routedTraceCuts.flatMap(({ fromSourcePortId, toSourcePortId }) => {
        requireDistinctNodes({
          node,
          from: fromSourcePortId,
          to: toSourcePortId,
        })
        return [fromSourcePortId, toSourcePortId]
      }),
    )
    for (const {
      driver,
      receivers,
    } of db.simulation_pcb_driver_receiver_channel.list()) {
      for (const endpoint of [driver, ...receivers]) {
        if ("source_port_id" in endpoint) continue
        requireDistinctNodes({
          node,
          from: endpoint.p_source_port_id,
          to: endpoint.n_source_port_id,
        })
      }
    }
  }
  const portsByNode = new Map<string, SourcePortId[]>()
  for (const port of endpoints) {
    const name = node(port)
    const previous = portsByNode.get(name) ?? []
    if (
      previous.some(
        (other) =>
          !idealRoutedJunctions.some(
            ({ fromSourcePortId, toSourcePortId }) =>
              (fromSourcePortId === port && toSourcePortId === other) ||
              (toSourcePortId === port && fromSourcePortId === other),
          ),
      )
    )
      channelShort()
    portsByNode.set(name, [...previous, port])
  }
}
