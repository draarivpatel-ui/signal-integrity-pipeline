import type { GraphicsObject, Text } from "graphics-debug"
import {
  PLAN_BAND_GAP,
  PLAN_LINE_STEP,
  wrapPlanText,
} from "../../src/board/plan-header"
import { routeBounds } from "../../src/board/plan-view"

/** Add the fixture's explanation and extend the plan picture below the board. */
export function withPlanCaption({
  drawing,
  caption,
}: {
  drawing: GraphicsObject
  caption: string
}): GraphicsObject {
  const frame = drawing.rects?.find(({ layer }) => layer === "frame")
  const header = drawing.texts?.find(({ layer }) => layer === "header")
  if (frame === undefined || header?.fontSize === undefined)
    throw new Error("A test caption requires a framed plan drawing")
  const { fontSize: size, color } = header

  const board = routeBounds([
    ...(drawing.polygons || []).flatMap(({ points }) => points),
    ...(drawing.lines || [])
      .filter(({ layer }) => layer !== "header")
      .flatMap(({ points }) => points),
    ...(drawing.texts || []).filter(({ layer }) => layer !== "header"),
  ])
  if (board === undefined) throw new Error("The plan drawing has no board")

  const x = frame.center.x
  const firstY = board.minY - size * (PLAN_BAND_GAP + 0.5)
  const texts = wrapPlanText({ text: caption, width: frame.width / size }).map(
    (text, i): Text => ({
      x,
      y: firstY - size * PLAN_LINE_STEP * i,
      text,
      anchorSide: "center",
      fontSize: size,
      color,
      layer: "test caption",
    }),
  )
  const last = texts.at(-1)
  if (last === undefined) throw new Error("The test caption has no text")
  const top = frame.center.y + frame.height / 2
  const bottom = last.y - size
  return {
    ...drawing,
    texts: [...(drawing.texts || []), ...texts],
    rects: drawing.rects?.map((rect) => {
      if (rect !== frame) return rect
      return {
        ...rect,
        center: { x, y: (top + bottom) / 2 },
        height: top - bottom,
      }
    }),
  }
}
