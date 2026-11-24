import {
  Point as BoardPoint,
  Polygon as BoardPolygon,
  Box,
  Segment,
} from "@flatten-js/core"
import type { Line, Point, Polygon, Text } from "graphics-debug"
import type { SourcePortId } from "./ids"
import { estimateTextWidthEms, getPlanTextSizeMm } from "./plan-header"
import {
  boxPoints,
  getPinName,
  getPointBounds,
  type PlanFrame,
  type PlanPort,
} from "./plan-view"
import {
  getTraceColor,
  type PlanVisualScene,
  planColors,
  planPourFills,
} from "./plan-visual-types"

/** A name anchored to a board feature. */
type PlanLabel = {
  text: string
  color: string
  anchor: Box
} & (
  | { kind: "pin" | "part" }
  | { kind: "pour"; outline: BoardPolygon; legend: string }
)

/** Board annotations to draw above the copper. */
interface PlanLabels {
  texts: Text[]
  backgrounds: Polygon[]
  leaders: Line[]
  pourLegendEntries: string[]
}

/** Prefer the fault indication, then the endpoint marker, then the cut or link. */
function pinColors(scene: PlanVisualScene): Map<SourcePortId, string> {
  const colors = new Map<SourcePortId, string>()
  for (const { fromSourcePortId, toSourcePortId, kind } of scene.overlays) {
    let color: string = planColors.failure
    if (kind === "series" || kind === "ideal") color = planColors[kind]
    colors.set(fromSourcePortId, color)
    colors.set(toSourcePortId, color)
  }
  for (const { fromSourcePortId, toSourcePortId, index } of [
    ...scene.traces,
  ].reverse()) {
    colors.set(fromSourcePortId, getTraceColor(index))
    colors.set(toSourcePortId, getTraceColor(index))
  }
  for (const { sourcePortId, color } of scene.endpoints)
    colors.set(sourcePortId, color)
  for (const sourcePortId of scene.faultSourcePortIds)
    colors.set(sourcePortId, planColors.failure)
  return colors
}

/** Convert the projected bounds of a board mark to a collision box. */
function markBox(polygon: Polygon): Box | undefined {
  const bounds = getPointBounds(polygon.points)
  if (bounds === undefined) return
  const stroke = (polygon.strokeWidth || 0) / 2
  return new Box(
    bounds.minX - stroke,
    bounds.minY - stroke,
    bounds.maxX + stroke,
    bounds.maxY + stroke,
  )
}

/** The center of a label box supplies both its text and backing positions. */
function labelBox({
  x,
  y,
  width,
  height,
}: Point & { width: number; height: number }): Box {
  return new Box(x - width / 2, y - height / 2, x + width / 2, y + height / 2)
}

/** Place labels against a mark first, then step outward if that space is occupied. */
function placeLabel({
  label,
  size,
  window,
  isBoxClear,
}: {
  label: PlanLabel
  size: number
  window: Box
  isBoxClear: (box: Box) => boolean
}): Box | undefined {
  const { anchor, text } = label
  const width = (estimateTextWidthEms(text) + 0.45) * size
  const height = size * 1.27
  const center = anchor.center
  if (label.kind === "pour") {
    for (const xFraction of [0.5, 0.34, 0.66, 0.25, 0.75]) {
      for (const yFraction of [0.27, 0.5, 0.73]) {
        const box = labelBox({
          x: anchor.xmin + anchor.width * xFraction,
          y: anchor.ymin + anchor.height * yFraction,
          width,
          height,
        })
        if (
          window.contains(box) &&
          label.outline.contains(new BoardPolygon(box)) &&
          isBoxClear(box)
        )
          return box
      }
    }
    return
  }
  let sides = [-1, 1]
  if (label.kind === "pin") sides = [1, -1]
  const margin = size * 0.19
  if (width + margin * 2 < window.width) {
    const x = Math.max(
      window.xmin + width / 2 + margin,
      Math.min(window.xmax - width / 2 - margin, center.x),
    )
    for (let step = 0; step * size <= window.height; step++) {
      for (const side of sides) {
        let edge = anchor.ymin
        if (side > 0) edge = anchor.ymax
        const y = edge + side * ((step + 0.5) * height + margin)
        for (const dx of [0, -step * size, step * size]) {
          const box = labelBox({ x: x + dx, y, width, height })
          if (window.contains(box) && isBoxClear(box)) return box
        }
      }
      if (label.kind === "part") {
        const gap = width / 2 + margin + step * size
        for (const x of [anchor.xmax + gap, anchor.xmin - gap]) {
          const box = labelBox({ x, y: center.y, width, height })
          if (window.contains(box) && isBoxClear(box)) return box
        }
      }
    }
  }
  // A crowded crop can run out of room. Continue into the margin at full size.
  const x = window.xmax + width / 2 + size
  for (let y = center.y; ; y -= height + margin) {
    const box = labelBox({ x, y, width, height })
    if (isBoxClear(box)) return box
  }
}

/** Keep the leader clear of the backing and start it at the actual pin. */
function labelLeader({
  label,
  box,
  size,
}: {
  label: PlanLabel
  box: Box
  size: number
}): Line | undefined {
  const { anchor, color } = label
  const from = anchor.center
  const to = new BoardPoint(
    Math.max(box.xmin, Math.min(box.xmax, from.x)),
    Math.max(box.ymin, Math.min(box.ymax, from.y)),
  )
  const gap = new Segment(from, to)
  const [edge] = gap.intersect(anchor)
  if (
    edge === undefined ||
    Math.hypot(to.x - edge.x, to.y - edge.y) <= size * 0.55
  )
    return
  return {
    points: [edge, to],
    strokeColor: color,
    strokeWidth: size * 0.075,
    layer: "labels",
  }
}

/** A labeled polygon and its projected board bounds. */
interface BoardMark {
  polygon: Polygon
  bounds: Box
}

/** Gather candidate labels in pin, part, then pour order. */
function collectPlanLabels({
  scene,
  ports,
  radius,
  window,
  marks,
  bodies,
  polygons,
}: {
  scene: PlanVisualScene
  ports: ReadonlyMap<SourcePortId, PlanPort>
  radius: number
  window: Box
  marks: readonly BoardMark[]
  bodies: readonly Box[]
  polygons: readonly Polygon[]
}): PlanLabel[] {
  const pins = [...pinColors(scene)].flatMap(
    ([sourcePortId, color]): PlanLabel[] => {
      const port = ports.get(sourcePortId)
      if (
        port === undefined ||
        !window.contains(new BoardPoint(port.x, port.y))
      )
        return []
      let markerSizeMm = radius * 2
      if (scene.faultSourcePortIds.has(sourcePortId))
        markerSizeMm = radius * 2.5
      return [
        {
          text: getPinName({ sourcePortId, db: scene.db }),
          color,
          anchor: labelBox({
            ...port,
            width: markerSizeMm,
            height: markerSizeMm,
          }),
          kind: "pin",
        },
      ]
    },
  )
  const parts = marks.flatMap(({ polygon, bounds }): PlanLabel[] => {
    if (polygon.layer !== "parts" || !polygon.label) return []
    // A footprint inside a larger body reads as part of that body.
    if (
      bodies.some(
        (body) =>
          body.xmin < bounds.xmin &&
          body.xmax > bounds.xmax &&
          body.ymin < bounds.ymin &&
          body.ymax > bounds.ymax,
      )
    )
      return []
    return [
      {
        text: polygon.label,
        color: planColors.ink,
        anchor: bounds,
        kind: "part",
      },
    ]
  })
  const pours = polygons.flatMap((polygon): PlanLabel[] => {
    if (polygon.layer !== "pours" || !polygon.label) return []
    const outline = new BoardPolygon(polygon.points.map(({ x, y }) => [x, y]))
    let glyph = "□"
    if (polygon.fill === planPourFills.pink) glyph = "■"
    return [
      {
        kind: "pour",
        text: polygon.label,
        color: planColors.quiet,
        anchor: outline.box,
        outline,
        legend: `${glyph} ${polygon.label}`,
      },
    ]
  })
  return [...pins, ...parts, ...pours]
}

/** Lay out readable pin and component names without crossing visible marks. */
export function placePlanLabels({
  scene,
  frame,
  ports,
  radius,
  polygons,
  lines,
}: {
  scene: PlanVisualScene
  frame: PlanFrame
  ports: ReadonlyMap<SourcePortId, PlanPort>
  radius: number
  polygons: readonly Polygon[]
  lines: readonly Line[]
}): PlanLabels {
  const { box } = frame
  const window = new Box(box.minX, box.minY, box.maxX, box.maxY)
  const size = getPlanTextSizeMm(frame.widthMm)
  const marks = polygons.flatMap((polygon) => {
    if (polygon.layer === "board" || polygon.layer === "pours") return []
    const bounds = markBox(polygon)
    if (!bounds) return []
    return [{ polygon, bounds }]
  })
  const bodies = marks
    .filter(
      ({ polygon }) => polygon.layer === "parts" || polygon.layer === "bodies",
    )
    .map(({ bounds }) => bounds)
  const obstacles = marks
    .filter(
      ({ polygon }) => polygon.layer !== "parts" && polygon.layer !== "bodies",
    )
    .map(({ bounds }) => bounds)
  const strokes = lines.flatMap(({ points, strokeWidth }) =>
    points.slice(1).map((end, index) => ({
      segment: new Segment(
        new BoardPoint(points[index].x, points[index].y),
        new BoardPoint(end.x, end.y),
      ),
      clearance: (strokeWidth || 0) / 2,
    })),
  )
  const candidates = collectPlanLabels({
    scene,
    ports,
    radius,
    window,
    marks,
    bodies,
    polygons,
  })
  const texts: Text[] = []
  const backgrounds: Polygon[] = []
  const leaders: Line[] = []
  const namedPours = new Set<string>()
  const pourLegendEntries = new Map<string, string>()
  for (const label of candidates) {
    let fontSize = size
    if (label.kind === "pour") {
      if (namedPours.has(label.text)) continue
      fontSize = size * 0.86
    }
    let blocked = obstacles
    if (label.kind !== "pin") blocked = [...obstacles, ...bodies]
    const placement = placeLabel({
      label,
      size: fontSize,
      window,
      isBoxClear: (box) =>
        blocked.every((obstacle) => box.not_intersect(obstacle)) &&
        strokes.every(({ segment, clearance }) => {
          const padded = new Box(
            box.xmin - clearance,
            box.ymin - clearance,
            box.xmax + clearance,
            box.ymax + clearance,
          )
          return (
            padded.not_intersect(segment.box) ||
            (!padded.contains(segment.start) &&
              !padded.contains(segment.end) &&
              segment.intersect(padded).length === 0)
          )
        }),
    })
    if (placement === undefined) {
      if (label.kind === "pour") pourLegendEntries.set(label.text, label.legend)
      continue
    }
    const { x, y } = placement.center
    const layer = `${label.kind} labels`
    if (label.kind === "pour") {
      namedPours.add(label.text)
      pourLegendEntries.delete(label.text)
    }
    texts.push({
      x,
      y,
      text: label.text,
      color: label.color,
      anchorSide: "center",
      fontSize,
      layer,
    })
    obstacles.push(placement)
    if (label.kind === "pin") {
      backgrounds.push({
        points: boxPoints({
          minX: placement.xmin,
          minY: placement.ymin,
          maxX: placement.xmax,
          maxY: placement.ymax,
        }),
        fill: "#fff",
        stroke: "none",
        layer,
      })
      const leader = labelLeader({ label, box: placement, size })
      if (leader !== undefined) leaders.push(leader)
    }
  }
  return {
    texts,
    backgrounds,
    leaders,
    pourLegendEntries: [...pourLegendEntries.values()],
  }
}
