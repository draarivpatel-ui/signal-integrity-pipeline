import type { Line, Rect, Text, Viewbox } from "graphics-debug"
import type { AdmissionFrame } from "./admission-view"

/** One centered line of the admission ledger. */
export interface AdmissionHeaderRow {
  text: string
  color?: string
}

/** Data needed to frame the header, independent of the copper drawing. */
interface AdmissionHeaderScene {
  title: string
  summary: string
  diagnostic?: string
  rows: readonly AdmissionHeaderRow[]
  scope?: { readonly nearbyGapMm: number }
}

/** Primitives reserved above the highest board mark. */
interface AdmissionHeader {
  lines: Line[]
  rects: Rect[]
  texts: Text[]
}

const INK = "#0f172a"
const QUIET = "#475569"
const RED = "#b91c1c"
const MAX_DIAGNOSTIC_LINES = 4
const SCALE_LENGTHS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]

/** Wrap at a word boundary when possible, retaining long tokens and explicit line breaks. */
function wrapHeader({
  text,
  columns,
  limit = Infinity,
}: {
  text: string
  columns: number
  limit?: number
}): string[] {
  const rows: string[] = []
  for (const paragraph of text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\u2028", "\n")
    .replaceAll("\u2029", "\n")
    .split("\n")) {
    let remaining = paragraph.trim()
    while (remaining.length > columns) {
      let stop = remaining.lastIndexOf(" ", columns)
      if (stop <= 0) stop = columns
      rows.push(remaining.slice(0, stop))
      remaining = remaining.slice(stop).trimStart()
    }
    rows.push(remaining)
  }
  if (rows.length <= limit) return rows
  const shown = rows.slice(0, limit)
  shown[limit - 1] = `${shown[limit - 1].slice(0, columns - 1).trimEnd()}…`
  return shown
}

/** Pick a standard length near one eighth of the drawn width. */
function scaleLength(width: number): number {
  const target = width / 8
  return SCALE_LENGTHS.reduce((best, length) => {
    if (Math.abs(Math.log(length / target)) < Math.abs(Math.log(best / target)))
      return length
    return best
  })
}

/** Format the physical board and the possible local scope envelope. */
function dimensions({
  scene,
  board,
  scopeBox,
}: {
  scene: AdmissionHeaderScene
  board: Viewbox
  scopeBox?: Viewbox
}): string {
  const width = Number((board.maxX - board.minX).toFixed(2))
  const height = Number((board.maxY - board.minY).toFixed(2))
  const label = `Board ${width} × ${height} mm`
  if (!scene.scope) return label
  const gap = scene.scope.nearbyGapMm
  if (
    scopeBox &&
    scopeBox.minX === board.minX &&
    scopeBox.maxX === board.maxX &&
    scopeBox.minY === board.minY &&
    scopeBox.maxY === board.maxY
  )
    return `${label}   ·   Full-board scope envelope (${gap} mm)`
  return `${label}   ·   Copper scope envelope ≤ ${gap} mm`
}

/** Legend rows show the symbols and line encodings used by the visible layers. */
function legend(scene: AdmissionHeaderScene): AdmissionHeaderRow[] {
  const rows: AdmissionHeaderRow[] = []
  if (scene.rows.length) {
    rows.push({
      text: "▶ Driver    ◎ Receiver    ◇ Ideal receiver / load    › Mapped direction",
    })
    rows.push({
      text: "│ Cut boundary    ≋ Inner    – – Bottom    ▧ Series    ╌ Ideal join",
    })
  }
  if (scene.scope)
    rows.push({
      text: "Dotted teal · Scope    Teal · Nearby    Rose · Rail    Gray · Outside",
    })
  if (scene.diagnostic)
    rows.push({
      text: "⊙ Offending pin    – ✕ – Broken path    Blue · Existing route",
    })
  return rows
}

/** Center every text primitive above all physical geometry and put the scale on its own row. */
export function admissionHeader({
  scene,
  frame,
  board,
  boardTop,
  scopeBox,
}: {
  scene: AdmissionHeaderScene
  frame: AdmissionFrame
  board: Viewbox
  boardTop: number
  scopeBox?: Viewbox
}): AdmissionHeader {
  const { width, box } = frame
  const x = (box.minX + box.maxX) / 2
  const size = width / 52
  const rows = [
    {
      text: scene.title,
      color: scene.diagnostic ? RED : INK,
      size: size * 1.32,
    },
    { text: scene.summary, color: QUIET, size },
    ...wrapHeader({
      text: scene.diagnostic || "",
      columns: 69,
      limit: MAX_DIAGNOSTIC_LINES,
    })
      .filter(Boolean)
      .map((text) => ({ text, color: RED, size })),
    { text: dimensions({ scene, board, scopeBox }), color: QUIET, size },
    ...scene.rows.flatMap((row) =>
      wrapHeader({ text: row.text, columns: 74 }).map((text) => ({
        text,
        color: row.color || INK,
        size,
      })),
    ),
    ...legend(scene).map((row) => ({
      ...row,
      color: row.color || QUIET,
      size,
    })),
  ]
    .flatMap((row, index) => {
      if (index === 0)
        return wrapHeader({ text: row.text, columns: 54 }).map((text) => ({
          ...row,
          text,
        }))
      if (index === 1)
        return wrapHeader({ text: row.text, columns: 72 }).map((text) => ({
          ...row,
          text,
        }))
      return [row]
    })
    .filter((row) => row.text.length > 0)
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
  let y = labelY + size * 1.66
  for (const row of rows.reverse()) {
    texts.push({
      x,
      y,
      text: row.text,
      color: row.color,
      fontSize: row.size,
      anchorSide: "center",
      layer: "header",
    })
    y += row.size * 1.31
  }
  const top = y + size * 0.3
  const bottom = box.minY - size * 0.9
  const rects: Rect[] = [
    {
      center: { x, y: (top + bottom) / 2 },
      width: width + size * 3.6,
      height: top - bottom,
      fill: "none",
      stroke: "none",
      layer: "frame",
    },
  ]
  return { texts, rects, lines }
}
