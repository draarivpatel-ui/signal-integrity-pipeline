import type {
  GraphicsObject,
  Line,
  NinePointAnchor,
  Point,
  Viewbox,
} from "graphics-debug"
import {
  type RouteCopperNet,
  type RouteCopperView,
  routeBoardBox,
  routeCopperStyles,
} from "./admission-view"
import { type CircuitJsonDb, circuitJsonDb } from "./circuit-json-db"
import type { LaneMapping } from "./geometry/types"
import type { SourcePortId, SourceTraceId } from "./ids"
import type { CircuitJsonSnapshot } from "./schema"

/** Colours for physical copper, endpoint outlines and admission diagnostics. */
export const routeCopperTones = {
  copper: "#9aa3ad",
  halo: "#0b0f13",
  ideal: "#d6dde6",
  failure: "#f87171",
} as const

/** The primitive lists that the route drawings always provide. */
export type RouteDrawing = GraphicsObject &
  Required<
    Pick<GraphicsObject, "lines" | "circles" | "polygons" | "rects" | "texts">
  >

/** Resolve a full cycle into 24 points for consistent via and pin outlines. */
const CIRCLE_SEGMENTS = 24
/** Keep the failure message within the reserved drawing area. */
const FAILURE_LINE_LIMIT = 3

/** Create the invisible camera rectangle used by the stage renderer. */
export function routeCanvas(frame?: { camera: Viewbox }): RouteDrawing {
  const rects: RouteDrawing["rects"] = []
  if (frame) {
    const { minX, minY, maxX, maxY } = frame.camera
    rects.push({
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      fill: "none",
      stroke: "none",
      label: "camera",
    })
  }
  return {
    coordinateSystem: "cartesian",
    lines: [],
    circles: [],
    polygons: [],
    rects,
    texts: [],
  }
}

/** Copper with its layer in the stroke: top solid, inner layers hollow, bottom dimmed. */
export function routeStroke({
  points,
  color,
  width,
  layer,
  label,
}: {
  points: Point[]
  color: string
  width: number
  layer: string
  label?: string
}): Line[] {
  const line = {
    points,
    strokeColor: color,
    strokeWidth: width,
    label,
  }
  if (layer === "top") return [line]
  if (layer === "bottom")
    return [
      line,
      {
        points,
        strokeColor: "rgba(11, 15, 19, 0.5)",
        strokeWidth: width,
        label,
      },
    ]
  return [
    line,
    {
      points,
      strokeColor: routeCopperTones.halo,
      strokeWidth: width * 0.45,
      label,
    },
  ]
}

/** Contiguous points with the same copper layer and width. */
interface RouteRun {
  points: Point[]
  layer: string
  width: number
}

/** A stage can derive a copper tone from a richer net style. */
type RouteNetColor<Net extends RouteCopperNet> = (
  net: Net | undefined,
) => string

/** Draw a contiguous run using its net, or neutral copper for an unassigned route. */
function drawRouteRun<Net extends RouteCopperNet>({
  run,
  net,
  color,
}: {
  run: RouteRun
  net: Net | undefined
  color: RouteNetColor<Net> | undefined
}): Line[] {
  if (run.points.length <= 1) return []
  let strokeColor: string = routeCopperTones.copper
  if (net !== undefined) strokeColor = net.color
  if (color !== undefined) strokeColor = color(net)
  return routeStroke({ ...run, color: strokeColor, label: net?.label })
}

/** Selected copper as layer-aware strokes, one colour per electrical net. */
/** @internal */
export function routeNets<Net extends RouteCopperNet>({
  db,
  view,
  color,
}: {
  db: CircuitJsonDb
  view: Pick<RouteCopperView, "traces"> & {
    sources: ReadonlyMap<SourceTraceId, Net>
  }
  color?: RouteNetColor<Net>
}): RouteDrawing["lines"] {
  const lines: Line[] = []
  for (const trace of db.pcb_trace.list()) {
    if (!view.traces.has(trace.pcb_trace_id)) continue
    let net: Net | undefined
    if (trace.source_trace_id !== undefined)
      net = view.sources.get(trace.source_trace_id)
    let run: RouteRun | undefined
    for (const point of trace.route) {
      if (point.route_type !== "wire") {
        if (run) lines.push(...drawRouteRun({ run, net, color }))
        run = undefined
        continue
      }
      if (!run) {
        run = { points: [point], layer: point.layer, width: point.width }
        continue
      }
      if (run.layer !== point.layer || run.width !== point.width) {
        lines.push(...drawRouteRun({ run, net, color }))
        run = {
          points: [...run.points.slice(-1), point],
          layer: point.layer,
          width: point.width,
        }
        continue
      }
      run.points.push(point)
    }
    if (run) lines.push(...drawRouteRun({ run, net, color }))
  }
  return lines
}

/** A closed circle outline as polygon points. */
export function routeCircle({
  center,
  radius,
}: {
  center: Point
  radius: number
}): Point[] {
  return Array.from(
    {
      length: CIRCLE_SEGMENTS,
    },
    (_, i) => ({
      x: center.x + radius * Math.cos((i * Math.PI) / (CIRCLE_SEGMENTS / 2)),
      y: center.y + radius * Math.sin((i * Math.PI) / (CIRCLE_SEGMENTS / 2)),
    }),
  )
}

/** One placed driver or receiver and its drawing style. */
interface RouteMark {
  point: Point
  color: string
  driver: boolean
  label?: string
}

/** Pin marks over a halo, sized to fit the closest two distinct endpoints. */
export function routeMarks({
  marks,
  unit,
}: {
  marks: readonly RouteMark[]
  unit: number
}): RouteDrawing["polygons"] {
  const radius = Math.min(
    unit * 1.1,
    routePointSpacing(marks.map((mark) => mark.point)) * 0.38,
  )
  return marks.flatMap<RouteDrawing["polygons"][number]>(
    ({ point, color, driver, label }) => {
      const halo = {
        points: routeCircle({ center: point, radius: radius * 1.25 }),
        fill: routeCopperTones.halo,
        stroke: "none",
        label,
      }
      if (driver)
        return [
          halo,
          {
            points: routeCircle({ center: point, radius }),
            fill: color,
            stroke: "none",
            label,
          },
        ]
      return [
        halo,
        {
          points: routeCircle({ center: point, radius: radius * 0.8 }),
          stroke: color,
          strokeWidth: radius * 0.4,
          label,
        },
      ]
    },
  )
}

/** Put a net-coloured mark on copper contacts and a distinct mark on ideal-only signal contacts. */
/** @internal */
export function routeAdmissionMarks({
  db,
  mappings,
  view,
}: {
  db: CircuitJsonDb
  mappings: readonly LaneMapping[]
  view: Pick<RouteCopperView, "ports" | "unit">
}): RouteDrawing["polygons"] {
  const positions = new Map<SourcePortId, Point>()
  for (const port of db.pcb_port.list()) {
    const id = port.source_port_id
    if (id !== undefined && !positions.has(id)) positions.set(id, port)
  }
  const marks = mappings.flatMap(({ from, to, port }) =>
    (
      [
        [from, true],
        [to, false],
      ] as const
    ).flatMap(([id, driver]) => {
      const point = positions.get(id)
      if (point === undefined) return []
      const net = view.ports.get(id)
      if (net !== undefined)
        return [{ point, driver, color: net.color, label: net.label }]
      return [{ point, driver, color: routeCopperTones.ideal, label: port }]
    }),
  )
  return routeMarks({ marks, unit: view.unit })
}

/** One label on a route drawing. */
type RouteText = NonNullable<GraphicsObject["texts"]>[number]

/** Small world-unit text; drawn only where a number cannot be shown by shape or colour. */
export function routeText({
  x,
  y,
  text,
  color,
  size,
  anchor = "center",
}: {
  x: number
  y: number
  text: string
  color: string
  size: number
  anchor?: NinePointAnchor
}): RouteText {
  return {
    x,
    y,
    text,
    color,
    fontSize: size,
    anchorSide: anchor,
  }
}

/** Find at most three line endings at whitespace without breaking identifiers. */
function failureLines({
  message,
  perLine,
}: {
  message: string
  perLine: number
}): string[] {
  const lines: string[] = []
  let start = 0
  while (start < message.length && lines.length < FAILURE_LINE_LIMIT) {
    let boundary = start
    for (
      let end = start + 1;
      end <= Math.min(start + perLine, message.length);
      end++
    ) {
      if ("\r\n\u2028\u2029".includes(message[end - 1])) break
      if (end === message.length || message[end].trim() === "") boundary = end
    }
    if (boundary === start) {
      start++
      continue
    }
    lines.push(message.slice(start, boundary + 1))
    start = boundary + 1
  }
  if (lines.length === 0) return [message]
  return lines
}

/** Wrap the solver's own diagnostic in red inside the reserved region. */
export function routeFailure({
  box,
  message,
}: {
  box: Viewbox
  message: string
}): RouteDrawing["texts"] {
  const width = box.maxX - box.minX
  const size = Math.max(
    1e-5,
    Math.min((box.maxY - box.minY) * 0.06, width / 40),
  )
  const perLine = Math.max(10, Math.floor((width * 0.9) / (size * 0.6)))
  return failureLines({ message, perLine }).map((line, i) =>
    routeText({
      x: box.minX + width * 0.05,
      y: box.maxY - size * (1.6 + i * 1.3),
      text: line.trim(),
      color: routeCopperTones.failure,
      size,
      anchor: "center_left",
    }),
  )
}

/** Draw the scoped copper and the admitted driver and receiver marks. */
/** @internal */
export function scopedAdmissionDrawing({
  db,
  view,
  mappings,
  error,
}: {
  db: CircuitJsonDb
  view: RouteCopperView
  mappings: readonly LaneMapping[]
  error: string | null
}): RouteDrawing {
  const texts = admissionFailureTexts({ box: view.camera, error })
  return {
    ...routeCanvas({ camera: view.camera }),
    lines: routeNets({ db, view }),
    polygons: routeAdmissionMarks({ db, mappings, view }),
    texts,
  }
}

/** The whole board and its routed copper before any channel has been planned. */
export function unscopedAdmissionDrawing({
  circuit,
  error,
}: {
  circuit: CircuitJsonSnapshot
  error: string | null
}): RouteDrawing {
  const db = circuitJsonDb(circuit)
  const traces = new Set(db.pcb_trace.list().map((trace) => trace.pcb_trace_id))
  const box = routeBoardBox(db)
  const { minX, minY, maxX, maxY } = box
  const border = Math.max(maxX - minX, maxY - minY) * 0.004
  const board = db.pcb_board.getWhere({})
  let points = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
  if (board?.outline?.length) points = [...board.outline]
  return {
    ...routeCanvas(),
    lines: routeNets({
      db,
      view: routeCopperStyles({ db, traces }),
    }),
    polygons: [
      {
        points,
        stroke: routeCopperTones.copper,
        strokeWidth: border,
        label: "board",
      },
    ],
    texts: admissionFailureTexts({ box, error }),
  }
}

/** Closest spacing between distinct points, so glyphs never overlap their neighbours. */
export function routePointSpacing(points: readonly Point[]): number {
  let closest = Infinity
  for (const [i, a] of points.entries())
    for (const b of points.slice(i + 1)) {
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (distance > 1e-9) closest = Math.min(closest, distance)
    }
  return closest
}

/** A pending or successful admission has no diagnostic text. */
function admissionFailureTexts({
  box,
  error,
}: {
  box: Viewbox
  error: string | null
}): RouteDrawing["texts"] {
  if (error === null) return []
  return routeFailure({ box, message: error })
}
