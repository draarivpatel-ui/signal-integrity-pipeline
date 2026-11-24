import {
  BooleanOperations,
  Box,
  Point as CopperPoint,
  Polygon as CopperPolygon,
  type Face,
  Segment,
} from "@flatten-js/core"
import {
  type CircuitJsonUtilObjects,
  getPlatedHolePolygon,
  getPourPolygon,
  getSmtPadPolygon,
  roundedRectangle,
} from "@tscircuit/circuit-json-util"
import type { PcbPlatedHole, PcbSmtPad, PcbTrace } from "circuit-json"
import type { Line, Point, Polygon, Viewbox } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import { planPourFills } from "./plan-visual-types"

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

/** The board's physical extent, including unscoped copper on boards without a boundary. */
/** @internal */
export function routeBoardBox(db: CircuitJsonUtilObjects): Viewbox {
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
    if (record.type === "pcb_trace") return tracePoints(record)
    if (!record.type.startsWith("pcb_") || !("x" in record) || !("y" in record))
      return []
    if (typeof record.x !== "number" || typeof record.y !== "number") return []
    return [{ x: record.x, y: record.y }]
  })
  const positioned = routeBounds(points)
  if (positioned !== undefined) return positioned
  // Keep the empty PCB coordinate system visible for planning errors.
  return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
}

/** The board window and its geometric scale before reserving header space. */
/** @internal */
export interface PlanFrame {
  box: Viewbox
  crop?: Box
  width: number
  unit: number
}

/** Pad, via and through-pad contacts use the same board coordinates. */
/** @internal */
export interface PlanPort extends Point {
  id: SourcePortId
  label: string
}

/** Index placed signal ports and prefer a stable human-readable pin name. */
/** @internal */
export function planPorts(
  db: CircuitJsonUtilObjects,
): Map<SourcePortId, PlanPort> {
  const ports = new Map<SourcePortId, PlanPort>()
  const sources = new Map(
    db.source_port.list().map((port) => [port.source_port_id, port]),
  )
  const components = new Map(
    db.source_component
      .list()
      .map((component) => [component.source_component_id, component.name]),
  )
  for (const { source_port_id: id, x, y } of db.pcb_port.list()) {
    if (ports.has(id)) continue
    const source = sources.get(id)
    let label = id
    if (source) {
      const component = components.get(source.source_component_id || "")
      if (component) label = `${component}.${source.name}`
    }
    ports.set(id, { id, label, x, y })
  }
  return ports
}

/** Name a pin from its source records, including pins without a PCB pad. */
export function pinName({
  id,
  db,
}: {
  id: SourcePortId
  db: CircuitJsonUtilObjects
}): string {
  const pin = db.source_port.get(id)
  if (!pin) return "unknown pin"
  const part = db.source_component.get(pin.source_component_id || "")
  let pinLabel = pin.name
  const number = pinLabel.slice("pin".length)
  if (
    pinLabel.startsWith("pin") &&
    number &&
    [...number].every((digit) => "0123456789".includes(digit))
  )
    pinLabel = number
  const name = `pin ${pinLabel}`
  if (part?.name) return `${part.name} ${name}`
  return name
}

/** Include a through-pad route's two endpoints in its planar bounds. */
function tracePoints(trace: PcbTrace): Point[] {
  return trace.route.flatMap((point) => {
    if (point.route_type === "through_pad") return [point.start, point.end]
    return [point]
  })
}

/** Corners in winding order, without a duplicate closing vertex. */
/** @internal */
export function boxPoints({ minX, minY, maxX, maxY }: Viewbox): Point[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
}

/** Enlarge around the center until no dimension exceeds 2.2 times the other. */
function fitBox(box: Viewbox): Viewbox {
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  const aspectLimit = 2.2
  const x = (box.minX + box.maxX) / 2
  const y = (box.minY + box.maxY) / 2
  const halfWidth = Math.max(width, height / aspectLimit, 1) / 2
  const halfHeight = Math.max(height, width / aspectLimit, 1) / 2
  return {
    minX: x - halfWidth,
    maxX: x + halfWidth,
    minY: y - halfHeight,
    maxY: y + halfHeight,
  }
}

/** Use full board context on small boards and crop large boards around scoped copper. */
/** @internal */
export function planFrame({
  board,
  focus,
}: {
  board: Viewbox
  focus?: Viewbox
}): PlanFrame {
  let window = board
  const boardSpan = Math.max(board.maxX - board.minX, board.maxY - board.minY)
  if (
    focus &&
    boardSpan >
      3 * Math.max(focus.maxX - focus.minX, focus.maxY - focus.minY, 1)
  ) {
    window = focus
  }
  const box = fitBox(window)
  const width = box.maxX - box.minX
  const frame: PlanFrame = { box, width, unit: width / 92 }
  if (window !== board)
    frame.crop = new Box(box.minX, box.minY, box.maxX, box.maxY)
  return frame
}

/** The containing XY envelope of the selected copper, limited to the board. */
/** @internal */
export function planScopeBox({
  db,
  board,
  scope,
  active,
  ports,
}: {
  db: CircuitJsonUtilObjects
  board: Viewbox
  scope: Snapshot<CopperScope>
  active: ReadonlySet<SourcePortId>
  ports: ReadonlyMap<SourcePortId, PlanPort>
}): Viewbox | undefined {
  const traces = new Set(scope.channelPcbTraceIds)
  const positions = [...ports.values()].filter((port) => active.has(port.id))
  const activePcbPorts = new Set(
    db.pcb_port
      .list()
      .filter((port) => active.has(port.source_port_id))
      .map((port) => port.pcb_port_id),
  )
  const pads = [...db.pcb_smtpad.list(), ...db.pcb_plated_hole.list()].flatMap(
    (pad) => {
      if (pad.pcb_port_id === undefined || !activePcbPorts.has(pad.pcb_port_id))
        return []
      const { xmin, ymin, xmax, ymax } = padOutline({ db, pad }).box
      return [
        { x: xmin, y: ymin },
        { x: xmax, y: ymax },
      ]
    },
  )
  const bounds = routeBounds([
    ...positions,
    ...pads,
    ...db.pcb_trace.list().flatMap((trace) => {
      if (traces.has(trace.pcb_trace_id)) return tracePoints(trace)
      return []
    }),
  ])
  if (!bounds) return
  const gap = scope.nearbyGapMm
  return {
    minX: Math.max(board.minX, bounds.minX - gap),
    maxX: Math.min(board.maxX, bounds.maxX + gap),
    minY: Math.max(board.minY, bounds.minY - gap),
    maxY: Math.min(board.maxY, bounds.maxY + gap),
  }
}

/** Clip a segment to the display bounds while retaining its direction. */
function clippedSegment({
  start,
  end,
  crop,
}: {
  start: Point
  end: Point
  crop: Box
}): Point[] {
  const s = new Segment(
    new CopperPoint(start.x, start.y),
    new CopperPoint(end.x, end.y),
  )
  const points: Point[] = s.intersect(crop)
  if (crop.contains(s.start)) points.push(start)
  if (crop.contains(s.end)) points.push(end)
  if (points.length < 2) return []
  return points
    .sort(
      (a, b) =>
        Math.hypot(a.x - start.x, a.y - start.y) -
        Math.hypot(b.x - start.x, b.y - start.y),
    )
    .slice(0, 2)
}

/** Clip strokes to the window using their actual segments. */
/** @internal */
export function clipPlanLines({
  lines,
  crop,
}: {
  lines: Line[]
  crop?: Box
}): Line[] {
  if (!crop) return lines
  return lines.flatMap((line) =>
    line.points.slice(1).flatMap((end, index) => {
      const points = clippedSegment({ start: line.points[index], end, crop })
      if (points.length < 2) return []
      return [{ ...line, points }]
    }),
  )
}

/** Clip board geometry to the window before converting it to graphics primitives. */
/** @internal */
export function clipPlanPolygons({
  polygons,
  crop,
}: {
  polygons: Polygon[]
  crop?: Box
}): Polygon[] {
  if (!crop) return polygons
  const window = new CopperPolygon(crop)
  return polygons.flatMap((polygon) => {
    const shape = new CopperPolygon(polygon.points.map(({ x, y }) => [x, y]))
    if (crop.not_intersect(shape.box)) return []
    if (crop.contains(shape.box)) return [polygon]
    return BooleanOperations.intersect(shape, window)
      .splitToIslands()
      .map((island) => ({ ...polygon, points: island.vertices }))
  })
}

/** Board pad records of either technology. */
type PlanPad = PcbSmtPad | PcbPlatedHole

/** Reuse the native PCB outline and the owning rotation for footprint-local polygon pads. */
function padOutline({
  db,
  pad,
}: {
  db: CircuitJsonUtilObjects
  pad: PlanPad
}): CopperPolygon {
  if (pad.type === "pcb_smtpad") return getSmtPadPolygon(pad)
  const component = db.pcb_component.get(pad.pcb_component_id || "")
  return getPlatedHolePolygon(pad, component?.rotation)
}

/** Sample arcs from geometry so circular and rounded shapes keep their outlines. */
function facePoints(face: Face): Point[] {
  return face.edges.flatMap(({ shape }) => {
    if (shape instanceof Segment) return [shape.start]
    const steps = Math.max(4, Math.ceil(shape.sweep * 6))
    return Array.from({ length: steps }, (_, i) =>
      shape.pointAtLength((shape.length * i) / steps),
    ).filter((point) => point !== null)
  })
}

/** Use the outer copper loops, keeping separate islands in separate polygons. */
function facePolygons(polygon: CopperPolygon): Point[][] {
  return polygon.splitToIslands().flatMap((island) => {
    const [face] = island.faces as Iterable<Face>
    if (!face) return []
    return [facePoints(face)]
  })
}

/** Keep fills subtle since the SVG renderer draws all polygons above trace lines. */
/** @internal */
export function planBoardShapes({
  db,
  board,
  active,
  ports,
  unit,
}: {
  db: CircuitJsonUtilObjects
  board: Viewbox
  active: ReadonlySet<SourcePortId>
  ports: ReadonlyMap<SourcePortId, PlanPort>
  unit: number
}): Polygon[] {
  const outline = db.pcb_board.getWhere({})?.outline
  let boardPoints = boxPoints(board)
  if (outline?.length) boardPoints = [...outline]
  const shapes: Polygon[] = [
    {
      points: boardPoints,
      fill: "rgba(248,250,252,0.16)",
      stroke: "#64748b",
      strokeWidth: unit * 0.6,
      layer: "board",
      label: "board",
    },
  ]
  for (const pour of db.pcb_copper_pour.list()) {
    const net = db.source_net.get(pour.source_net_id || "")
    let label = `Copper (${pour.layer})`
    if (net?.name) label = `${net.name} copper (${pour.layer})`
    let fill: string = planPourFills.gray
    if (net?.is_power === true && net.is_ground !== true)
      fill = planPourFills.pink
    for (const points of facePolygons(getPourPolygon(pour)))
      shapes.push({
        points,
        fill,
        stroke: "#cbd5e1",
        strokeWidth: unit * 0.26,
        layer: "pours",
        label,
      })
  }
  const names = new Map(
    db.source_component
      .list()
      .map((component) => [component.source_component_id, component.name]),
  )
  for (const component of db.pcb_component.list()) {
    if (component.width <= 0 || component.height <= 0) continue
    const shape = roundedRectangle(
      component.center,
      component.width,
      component.height,
      0,
      component.rotation,
    )
    const name = names.get(component.source_component_id)
    shapes.push({
      points: facePolygons(shape).flat(),
      fill: "rgba(241,245,249,0.18)",
      stroke: "#94a3b8",
      strokeWidth: unit * 0.32,
      layer: name ? "parts" : "bodies",
      label: name || component.pcb_component_id,
    })
  }
  const idByPcbPort = new Map(
    db.pcb_port.list().map((port) => [port.pcb_port_id, port.source_port_id]),
  )
  for (const pad of [...db.pcb_smtpad.list(), ...db.pcb_plated_hole.list()]) {
    const id = idByPcbPort.get(pad.pcb_port_id || "")
    const port = id && ports.get(id)
    let fill = "#cbd5e1"
    let stroke = "#94a3b8"
    if (id && active.has(id)) {
      fill = "#64748b"
      stroke = "#334155"
    }
    const shape = padOutline({ db, pad })
    for (const island of shape.splitToIslands()) {
      const [outer, ...holes] = island.faces as Iterable<Face>
      if (!outer) continue
      shapes.push({
        points: facePoints(outer),
        fill,
        stroke,
        strokeWidth: unit * 0.22,
        layer: "pads",
        label: port ? `${port.label} (${port.id})` : pad.type,
      })
      for (const hole of holes)
        shapes.push({
          points: facePoints(hole),
          fill: "#fff",
          stroke: "none",
          layer: "pads",
        })
    }
  }
  return shapes
}
