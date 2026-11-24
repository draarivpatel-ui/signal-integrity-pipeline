import type { Line, Rect, Text } from "graphics-debug"
import type { PlanFrame } from "./plan-view"

/** One centered line of the plan header. */
export interface PlanHeaderRow {
  text: string
  color?: string
}

/** Data needed to frame the header, independent of the copper drawing. */
interface PlanHeaderScene {
  title: string
  diagnostic?: { text: string; label: string }
  rows: readonly PlanHeaderRow[]
}

/** Primitives reserved above the highest board mark. */
interface PlanHeader {
  lines: Line[]
  rects: Rect[]
  texts: Text[]
}

const INK = "#0f172a"
const QUIET = "#475569"
const RED = "#b91c1c"
const SCALE_LENGTHS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]

/** Pick a standard length near one eighth of the drawn width. */
function scaleLength(width: number): number {
  const target = width / 8
  return SCALE_LENGTHS.reduce((best, length) => {
    if (Math.abs(Math.log(length / target)) < Math.abs(Math.log(best / target)))
      return length
    return best
  })
}

/** Bound the width in sans-serif ems, including wide glyphs and fallback fonts. */
function headerWidth(text: string): number {
  let width = 0
  for (const char of text) {
    if (" ilI.,:;'|".includes(char)) width += 0.4
    else if ("mwMW@".includes(char)) width += 1.05
    else if (char > "~") width += 1.25
    else width += 0.8
  }
  return width
}

/** Center each line above the board, sizing long captions to fit the frame. */
export function planHeader({
  scene,
  frame,
  boardTop,
  legend,
}: {
  scene: PlanHeaderScene
  frame: PlanFrame
  boardTop: number
  legend: string
}): PlanHeader {
  const { width, box } = frame
  const x = (box.minX + box.maxX) / 2
  const size = width / 52
  const scale = scaleLength(width)
  const scaleY = boardTop + size * 1.54
  const labelY = scaleY + size * 0.88
  const lines: Line[] = [
    {
      points: [
        { x: x - scale / 2, y: scaleY + size * 0.23 },
        { x: x - scale / 2, y: scaleY },
        { x: x + scale / 2, y: scaleY },
        { x: x + scale / 2, y: scaleY + size * 0.23 },
      ],
      strokeColor: QUIET,
      strokeWidth: size * 0.085,
      label: `${scale} mm`,
      layer: "header",
    },
  ]
  const texts: Text[] = [
    {
      x,
      y: labelY,
      text: `${scale} mm`,
      anchorSide: "center",
      fontSize: size,
      color: QUIET,
      layer: "header",
    },
  ]
  const rows = [
    {
      text: scene.title,
      color: scene.diagnostic ? RED : INK,
      size: size * 1.32,
    },
    {
      text: scene.diagnostic?.text,
      color: RED,
      size,
      label: scene.diagnostic?.label,
    },
    ...scene.rows.map((row) => ({ ...row, size })),
    { text: legend, color: QUIET, size },
  ]
  const rects: Rect[] = []
  let y = labelY + size * 1.66
  for (const row of rows.reverse()) {
    if (!row.text) continue
    const fontSize = Math.min(row.size, width / headerWidth(row.text))
    texts.push({
      x,
      y,
      text: row.text,
      color: row.color || INK,
      fontSize,
      anchorSide: "center",
      layer: "header",
    })
    if ("label" in row && row.label)
      rects.push({
        center: { x, y },
        width: headerWidth(row.text) * fontSize,
        height: size * 1.25,
        fill: "transparent",
        stroke: "none",
        label: row.label,
        layer: "header",
      })
    y += row.size * 1.31
  }
  const top = y + size * 0.3
  const bottom = box.minY - size * 0.9
  rects.push({
    center: { x, y: (top + bottom) / 2 },
    width: width + size * 3.6,
    height: top - bottom,
    fill: "none",
    stroke: "none",
    layer: "frame",
  })
  return { texts, rects, lines }
}
