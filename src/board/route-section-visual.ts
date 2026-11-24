import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { Circle, GraphicsObject, Line, Point, Text } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type { CopperPoint } from "./geometry/types"
import { drawPlanPolygon } from "./plan-shapes"
import { getBoardBounds, getBoxPoints } from "./plan-view"
import { getTraceColor, planColors, planPourFills } from "./plan-visual-types"
import type {
  RouteSection,
  RouteWire,
  SectionGeometry,
} from "./route-section-types"
import { getRoutePoint } from "./route-wire"

/** Fit annotation and marker sizes to the physical board width. */
const BOARD_UNITS = 80

/** Boundary and reference annotation for one section interval. */
interface SectionMarks {
  lines: Line[]
  text?: Text
}

/** Use the same vertical axis for graphics and PCB coordinates. */
function boardPoint([x, y]: Snapshot<CopperPoint>): Point {
  return { x, y }
}

/** A tick through the wire width at a longitudinal section boundary. */
function drawSectionBoundary({
  wire,
  positionMm,
  unitMm,
}: {
  wire: Snapshot<RouteWire>
  positionMm: number
  unitMm: number
}): Line {
  const point = getRoutePoint({ wire, positionMm })
  const halfTickMm = wire.widthMm / 2 + unitMm * 0.55
  const [x, y] = wire.direction
  return {
    points: [
      { x: point[0] - y * halfTickMm, y: point[1] + x * halfTickMm },
      { x: point[0] + y * halfTickMm, y: point[1] - x * halfTickMm },
    ],
    strokeWidth: unitMm * 0.13,
    strokeColor: planColors.ink,
  }
}

/** Draw one section with the layer and net of its reference. */
function drawSection({
  section,
  index,
  db,
  unitMm,
}: {
  section: Snapshot<RouteSection>
  index: number
  db: CircuitJsonUtilObjects
  unitMm: number
}): SectionMarks {
  const { startMm, endMm, wires, references } = section
  const color = getTraceColor(index)
  const label = references
    .map(({ layer, sourceNetId, lateralGapMm }) => {
      const name = db.source_net.get(sourceNetId)?.name || sourceNetId
      if (lateralGapMm === undefined) return `${name} · ${layer}`
      return `${name} edge · ${lateralGapMm.toFixed(2)} mm gap`
    })
    .join(" / ")
  const lines = wires.flatMap((wire): Line[] => [
    {
      points: [startMm, endMm].map((positionMm) =>
        boardPoint(getRoutePoint({ wire, positionMm })),
      ),
      strokeWidth: wire.widthMm,
      strokeColor: color,
      label: `${wire.layer} wire · ${label}`,
    },
    ...[startMm, endMm].map((positionMm) =>
      drawSectionBoundary({ wire, positionMm, unitMm }),
    ),
  ])
  const wire = wires.at(-1)
  if (!wire) return { lines }
  const center = getRoutePoint({ wire, positionMm: (startMm + endMm) / 2 })
  return {
    lines,
    text: {
      x: center[0],
      y: center[1] + wire.widthMm / 2 + unitMm * 0.9,
      text: label,
      fontSize: unitMm * 1.65,
      anchorSide: "bottom_center",
      color,
    },
  }
}

/** Draw the original trace as a light outline behind the modeled wire. */
function drawOriginalWires({
  db,
  pcbTraceIds,
  unitMm,
}: {
  db: CircuitJsonUtilObjects
  pcbTraceIds: ReadonlySet<RouteWire["pcbTraceId"]>
  unitMm: number
}): Line[] {
  return db.pcb_trace.list().flatMap(({ pcb_trace_id, route }): Line[] => {
    if (!pcbTraceIds.has(pcb_trace_id)) return []
    return route.flatMap((end, index): Line[] => {
      if (index === 0) return []
      const start = route[index - 1]
      if (
        start.route_type === "through_pad" ||
        end.route_type === "through_pad"
      )
        return []
      if (start.x === end.x && start.y === end.y) return []
      let widthMm = unitMm
      if (start.route_type === "wire") widthMm = start.width
      else if (end.route_type === "wire") widthMm = end.width
      return [
        {
          points: [start, end].map(({ x, y }) => ({ x, y })),
          strokeColor: planColors.excluded,
          strokeWidth: widthMm + unitMm * 0.65,
        },
      ]
    })
  })
}

/** Draw physical reference copper, section boundaries, contacts, vias and joins. */
export function drawRouteSections({
  db,
  geometry,
  error,
}: {
  db: CircuitJsonUtilObjects
  geometry?: Snapshot<SectionGeometry>
  error?: string
}): GraphicsObject {
  const board = getBoardBounds(db)
  const unitMm = (board.maxX - board.minX) / BOARD_UNITS || 0.1
  const outline = db.pcb_board.getWhere({})?.outline || getBoxPoints(board)
  const title = "Route sections"
  let statusColor: string = planColors.quiet
  if (error) statusColor = planColors.failure
  const drawing: GraphicsObject = {
    title,
    coordinateSystem: "cartesian",
    polygons: [
      {
        points: outline,
        stroke: planColors.excluded,
        strokeWidth: unitMm * 0.2,
        fill: "none",
      },
    ],
    texts: [
      {
        x: board.minX,
        y: board.maxY + unitMm * 3.9,
        anchorSide: "bottom_left",
        text: title,
        fontSize: unitMm * 2.7,
        color: planColors.ink,
      },
      {
        x: board.minX,
        y: board.maxY + unitMm * 1.7,
        anchorSide: "bottom_left",
        text:
          error ||
          "Ticks mark section boundaries. Circles mark ports and vias. Dashes mark ideal joins.",
        fontSize: unitMm * 1.45,
        color: statusColor,
      },
    ],
  }
  if (!geometry) return drawing

  const sections = geometry.sections.map((section, index) =>
    drawSection({ section, index, db, unitMm }),
  )
  const joins = geometry.wires.flatMap((wire) => wire.joins || [])
  const traceIds = new Set([
    ...geometry.wires.map((wire) => wire.pcbTraceId),
    ...joins.map((join) => join.pcbTraceId),
  ])
  const pours = geometry.pours.flatMap(({ polygon }) => {
    const [outer, ...holes] = polygon
    if (!outer?.length) return []
    return drawPlanPolygon({
      points: outer.map(boardPoint),
      holes: holes.map((ring) => ring.map(boardPoint)),
      fill: planPourFills.pink,
      stroke: planColors.rail,
      strokeWidth: unitMm * 0.12,
    })
  })
  const vias = geometry.vias.map(
    (via): Circle => ({
      center: boardPoint(via.point),
      radius: Math.max(via.outerDiameterMm / 2, unitMm * 0.55),
      stroke: planColors.ideal,
      fill: "white",
      label: `Via · ${via.layers.join(" / ")}`,
    }),
  )
  const ports = geometry.portContacts.map(
    (contact): Circle => ({
      center: boardPoint(contact.point),
      radius: unitMm * 0.42,
      stroke: planColors.ink,
      fill: "white",
      label: `Port · ${contact.layer}`,
    }),
  )
  return {
    ...drawing,
    polygons: [...(drawing.polygons || []), ...pours],
    lines: [
      ...drawOriginalWires({ db, pcbTraceIds: traceIds, unitMm }),
      ...sections.flatMap(({ lines }) => lines),
      ...joins.map(
        (join): Line => ({
          points: [join.fromPoint, join.toPoint].map(boardPoint),
          strokeColor: planColors.ideal,
          strokeWidth: unitMm * 0.2,
          strokeDash: "3,2",
        }),
      ),
    ],
    circles: [...ports, ...vias],
    texts: [
      ...(drawing.texts || []),
      ...sections.flatMap(({ text }) => {
        if (text) return [text]
        return []
      }),
    ],
  }
}
