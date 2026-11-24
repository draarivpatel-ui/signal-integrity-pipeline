import { Point as BoardPoint, Box, Segment } from "@flatten-js/core"
import type { Line, Point, Polygon, Text } from "graphics-debug"
import type { SourcePortId } from "./ids"
import { planTextSize } from "./plan-header"
import {
  boxPoints,
  type PlanFrame,
  type PlanPort,
  pinName,
  routeBounds,
} from "./plan-view"
import {
  type PlanVisualScene,
  planColors,
  planCutColor,
} from "./plan-visual-types"

/** A name anchored to a port or the visible bounds of a component. */
interface PlanLabel {
  text: string
  color: string
  anchor: Box
  kind: "pin" | "part"
}

/** Board annotations to draw above the copper. */
interface PlanLabels {
  texts: Text[]
  backgrounds: Polygon[]
  leaders: Line[]
}

/** Prefer the fault indication, then the endpoint marker, then the cut or link. */
function pinColors(scene: PlanVisualScene): Map<SourcePortId, string> {
  const colors = new Map<SourcePortId, string>()
  for (const { from, to, kind } of scene.links) {
    let color: string = planColors.failure
    if (kind === "series" || kind === "ideal") color = planColors[kind]
    colors.set(from, color)
    colors.set(to, color)
  }
  for (const { from, to, index } of [...scene.cuts].reverse()) {
    colors.set(from, planCutColor(index))
    colors.set(to, planCutColor(index))
  }
  for (const { id, color } of scene.endpoints) colors.set(id, color)
  for (const id of scene.faultPorts) colors.set(id, planColors.failure)
  return colors
}

/** Convert the projected bounds of a board mark to a collision box. */
function markBox(polygon: Polygon): Box | undefined {
  const bounds = routeBounds(polygon.points)
  if (bounds === undefined) return
  const stroke = (polygon.strokeWidth || 0) / 2
  return new Box(
    bounds.minX - stroke,
    bounds.minY - stroke,
    bounds.maxX + stroke,
    bounds.maxY + stroke,
  )
}

/** Estimate sans-serif glyph widths so the white backing stays close to the text. */
function labelWidth(text: string): number {
  let width = 0.45
  for (const char of text) {
    if (" .,:;!'ijlI|".includes(char)) width += 0.34
    else if ("mwMW@".includes(char) || char > "~") width += 1
    else if (char.toUpperCase() === char) width += 0.74
    else width += 0.61
  }
  return width
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
  clear,
}: {
  label: PlanLabel
  size: number
  window: Box
  clear: (box: Box) => boolean
}): Box {
  const { anchor, text } = label
  const width = labelWidth(text) * size
  const height = size * 1.27
  const center = anchor.center
  const sides = label.kind === "pin" ? [1, -1] : [-1, 1]
  const margin = size * 0.19
  if (width + margin * 2 < window.width) {
    const x = Math.max(
      window.xmin + width / 2 + margin,
      Math.min(window.xmax - width / 2 - margin, center.x),
    )
    for (let step = 0; step * size <= window.height; step++) {
      for (const side of sides) {
        const edge = side > 0 ? anchor.ymax : anchor.ymin
        const y = edge + side * ((step + 0.5) * height + margin)
        for (const dx of [0, -step * size, step * size]) {
          const box = labelBox({ x: x + dx, y, width, height })
          if (window.contains(box) && clear(box)) return box
        }
      }
      if (label.kind === "part") {
        const gap = width / 2 + margin + step * size
        for (const x of [anchor.xmax + gap, anchor.xmin - gap]) {
          const box = labelBox({ x, y: center.y, width, height })
          if (window.contains(box) && clear(box)) return box
        }
      }
    }
  }
  // A crowded crop can run out of room. Continue into the margin at full size.
  const x = window.xmax + width / 2 + size
  for (let y = center.y; ; y -= height + margin) {
    const box = labelBox({ x, y, width, height })
    if (clear(box)) return box
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

/** Lay out readable pin and component names without crossing visible marks. */
export function planLabels({
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
  const size = planTextSize(frame.width)
  const marks = polygons.flatMap((polygon) => {
    if (polygon.layer === "board") return []
    const bounds = markBox(polygon)
    return bounds === undefined ? [] : [{ polygon, bounds }]
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
  const pins = [...pinColors(scene)].flatMap(([id, color]): PlanLabel[] => {
    const port = ports.get(id)
    if (port === undefined || !window.contains(new BoardPoint(port.x, port.y)))
      return []
    const markerSize = scene.faultPorts.has(id) ? radius * 2.5 : radius * 2
    return [
      {
        text: pinName({ id, db: scene.db }),
        color,
        anchor: labelBox({ ...port, width: markerSize, height: markerSize }),
        kind: "pin",
      },
    ]
  })
  const parts = marks.flatMap(({ polygon, bounds }): PlanLabel[] => {
    if (polygon.layer !== "parts" || !polygon.label) return []
    return [
      {
        text: polygon.label,
        color: planColors.ink,
        anchor: bounds,
        kind: "part",
      },
    ]
  })
  const texts: Text[] = []
  const backgrounds: Polygon[] = []
  const leaders: Line[] = []
  for (const label of [...pins, ...parts]) {
    const blocked = label.kind === "pin" ? obstacles : [...obstacles, ...bodies]
    const placement = placeLabel({
      label,
      size,
      window,
      clear: (box) =>
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
    const { x, y } = placement.center
    const layer = label.kind === "pin" ? "pin labels" : "part labels"
    texts.push({
      x,
      y,
      text: label.text,
      color: label.color,
      anchorSide: "center",
      fontSize: size,
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
  return { texts, backgrounds, leaders }
}
