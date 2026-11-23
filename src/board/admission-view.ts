import type { Point, Viewbox } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type { CircuitJsonDb } from "./circuit-json-db"
import {
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "./connectivity"
import type { CopperScope } from "./geometry/scope"
import type {
  PcbTraceId,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "./ids"

/** The label and colour of an electrical net. */
export interface RouteCopperNet {
  label: string
  color: string
}

/** The selected trace and port styles used by the copper drawing. */
export interface RouteCopperStyles {
  traces: ReadonlySet<PcbTraceId>
  sources: ReadonlyMap<SourceTraceId, RouteCopperNet>
  ports: ReadonlyMap<SourcePortId, RouteCopperNet>
}

/** The camera and glyph scale alongside the copper styles. */
export interface RouteCopperView extends RouteCopperStyles {
  camera: Viewbox
  unit: number
}

/** A hue as a colour; `lightness` separates differential legs and section tones. */
export function routeHue({
  hue,
  lightness = 62,
  alpha = 1,
}: {
  hue: number
  lightness?: number
  alpha?: number
}): string {
  return `hsla(${Math.round(hue) % 360}, 90%, ${lightness}%, ${alpha})`
}

/** Bounds of points, or undefined when there are none. */
export function routeBounds(points: readonly Point[]): Viewbox | undefined {
  if (!points.length) return
  let box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  }
  for (const point of points)
    box = {
      minX: Math.min(box.minX, point.x),
      maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y),
      maxY: Math.max(box.maxY, point.y),
    }
  return box
}

/** Selected source traces grouped with their electrically connected IDs. */
export interface RouteSourceNet {
  ids: Set<SourcePortId | SourceNetId | SourceTraceId>
  sources: SourceTraceId[]
  firstSourceTraceId: SourceTraceId
}

/** Group traces by their source connectivity in first PCB trace order. */
/** @internal */
export function routeSourceNets({
  db,
  traces,
}: {
  db: CircuitJsonDb
  traces: ReadonlySet<PcbTraceId>
}): RouteSourceNet[] {
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(db.toArray())
  const nets = new Map<
    SourcePortId | SourceNetId | SourceTraceId,
    RouteSourceNet
  >()
  const sourceTraces = new Map(
    db.source_trace.list().map((trace) => [trace.source_trace_id, trace]),
  )
  const visited = new Set<SourceTraceId>()
  for (const pcbTrace of db.pcb_trace.list()) {
    const id = pcbTrace.source_trace_id
    if (
      !traces.has(pcbTrace.pcb_trace_id) ||
      id === undefined ||
      visited.has(id)
    )
      continue
    visited.add(id)
    const source = sourceTraces.get(id)
    const port = source?.connected_source_port_ids[0]
    const sourceNet = source?.connected_source_net_ids?.[0]
    let seed = id
    if (port !== undefined) seed = port
    else if (sourceNet !== undefined) seed = sourceNet
    const existing = nets.get(seed)
    if (existing !== undefined) {
      existing.sources.push(id)
      continue
    }
    const ids = sourceNetMembers({ connectivity, memberId: seed })
    const net = { ids, sources: [id], firstSourceTraceId: id }
    for (const memberId of ids) nets.set(memberId, net)
  }
  return [...new Set(nets.values())]
}

/** The board's physical extent, including unscoped copper on boards without a boundary. */
/** @internal */
export function routeBoardBox(db: CircuitJsonDb): Viewbox {
  const board = db.pcb_board.getWhere({})
  if (board?.outline) {
    const outline = routeBounds(board.outline)
    if (outline !== undefined) return outline
  }
  if (board?.width && board.height)
    return {
      minX: board.center.x - board.width / 2,
      maxX: board.center.x + board.width / 2,
      minY: board.center.y - board.height / 2,
      maxY: board.center.y + board.height / 2,
    }
  const points = db.toArray().flatMap<Point>((record) => {
    if (record.type === "pcb_trace")
      return record.route.flatMap<Point>((point) => {
        if (point.route_type === "through_pad") return [point.start, point.end]
        return [point]
      })
    if (!record.type.startsWith("pcb_") || !("x" in record) || !("y" in record))
      return []
    if (typeof record.x !== "number" || typeof record.y !== "number") return []
    return [{ x: record.x, y: record.y }]
  })
  const positioned = routeBounds(points)
  if (positioned !== undefined) return positioned
  // Keep the empty PCB coordinate system visible for admission errors.
  return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
}

/** Assign one colour per source net across the selected traces and their connected ports. */
/** @internal */
export function routeCopperStyles({
  db,
  traces,
}: {
  db: CircuitJsonDb
  traces: ReadonlySet<PcbTraceId>
}): RouteCopperStyles {
  const nets = routeSourceNets({ db, traces })
  const sources = new Map<SourceTraceId, RouteCopperNet>()
  const ports = new Map<SourcePortId, RouteCopperNet>()
  const sourcePorts = new Set(
    db.source_port.list().map((port) => port.source_port_id),
  )
  for (const [
    i,
    { ids, sources: sourceTraceIds, firstSourceTraceId },
  ] of nets.entries()) {
    const hue = 195 + (i * 360) / nets.length
    const port = [...ids].find((id) => sourcePorts.has(id))
    let label = firstSourceTraceId
    if (port !== undefined) label = port
    const style = { label, color: routeHue({ hue }) }
    for (const id of sourceTraceIds) sources.set(id, style)
    for (const id of ids) ports.set(id, style)
  }
  return { traces, sources, ports }
}

/** Fit the standalone drawing to the scoped trace points and the placed driver and receiver ports. */
/** @internal */
export function admissionRouteView({
  db,
  scope,
  endpointSourcePortIds,
}: {
  db: CircuitJsonDb
  scope: Snapshot<CopperScope>
  endpointSourcePortIds: ReadonlySet<SourcePortId>
}): RouteCopperView {
  const traces = new Set(scope.channelPcbTraceIds)
  const pcbTracePoints = db.pcb_trace.list().flatMap((trace) => {
    if (!traces.has(trace.pcb_trace_id)) return []
    return trace.route.filter((point) => point.route_type === "wire")
  })
  const pcbPorts = db.pcb_port
    .list()
    .filter(
      (port) =>
        port.source_port_id !== undefined &&
        endpointSourcePortIds.has(port.source_port_id),
    )
  let box = routeBounds([...pcbTracePoints, ...pcbPorts])
  if (box === undefined) box = routeBoardBox(db)
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3)
  // Keep the endpoint circles from touching the standalone camera border.
  const margin = span * 0.06
  return {
    ...routeCopperStyles({ db, traces }),
    camera: {
      minX: box.minX - margin,
      maxX: box.maxX + margin,
      minY: box.minY - margin,
      maxY: box.maxY + margin,
    },
    unit: span / 100,
  }
}
