import type { GraphicsObject, Line, Polygon, Viewbox } from "graphics-debug"
import { drawCopper } from "./plan-copper"
import { planHeader } from "./plan-header"
import { planLabels } from "./plan-labels"
import {
  endpointRadius,
  endpointShape,
  linkLine,
  linkShapes,
  ring,
  viaShapes,
} from "./plan-marks"
import {
  boxPoints,
  clipPlanLines,
  clipPlanPolygons,
  planBoardShapes,
  planFrame,
  planPorts,
  planScopeBox,
  routeBoardBox,
  routeBounds,
} from "./plan-view"
import { type PlanVisualScene, planColors } from "./plan-visual-types"

/** Scope envelope, separated from the board outline when fully in scope. */
function scopeLine({
  scope,
  board,
  unit,
}: {
  scope: Viewbox
  board: Viewbox
  unit: number
}): Line {
  const inset = unit * 0.6
  const points = boxPoints({
    minX: Math.max(board.minX + inset, scope.minX),
    maxX: Math.min(board.maxX - inset, scope.maxX),
    minY: Math.max(board.minY + inset, scope.minY),
    maxY: Math.min(board.maxY - inset, scope.maxY),
  })
  return {
    points: [...points, points[0]],
    strokeColor: planColors.scope,
    strokeWidth: unit * 0.37,
    strokeDash: "4,4",
    layer: "scope",
    label: "Copper search envelope",
  }
}

/** Explain only the symbols that were drawn inside the board window. */
function planLegend({
  scene,
  polygons,
  lines,
}: {
  scene: PlanVisualScene
  polygons: readonly Polygon[]
  lines: readonly Line[]
}): string[] {
  const kinds = new Set(
    scene.endpoints
      .filter(({ label }) =>
        polygons.some(
          (shape) => shape.layer === "endpoints" && shape.label === label,
        ),
      )
      .map(({ kind }) => kind),
  )
  const labels: string[] = []
  if (kinds.has("driver")) labels.push("▶ driver")
  if (kinds.has("receiver")) labels.push("◉ receiver")
  if (kinds.has("ideal") && kinds.has("extraTraceEnd"))
    labels.push("◇ direct receiver or extra trace end")
  else if (kinds.has("ideal")) labels.push("◇ direct receiver")
  else if (kinds.has("extraTraceEnd")) labels.push("◇ extra trace end")
  if (polygons.some(({ layer }) => layer === "mappings"))
    labels.push("› direction")
  if (polygons.some(({ layer }) => layer === "copper")) labels.push("◎ via")
  if (polygons.some(({ layer }) => layer === "topology"))
    labels.push("~ series part")
  if (lines.some(({ layer, strokeDash }) => layer === "topology" && strokeDash))
    labels.push("-- direct connection")
  if (lines.some(({ label }) => label === "Copper search envelope"))
    labels.push("▪▪ copper search envelope")
  const faults = new Set(
    lines.filter(({ layer }) => layer === "failure").map(({ label }) => label),
  )
  if (
    scene.links.some(
      ({ kind, label }) => kind === "missing" && faults.has(label),
    )
  )
    labels.push("-×- missing trace")
  const shortcut = scene.links.some(
    ({ kind, label }) => kind === "short" && faults.has(label),
  )
  if (shortcut) labels.push("-×- shortcut")
  if ([...faults].some((label) => label?.startsWith("Short or loop ·"))) {
    if (shortcut) labels.push("× bypassed trace")
    else if (scene.faultCode === "channel_fanout")
      labels.push("× trace in loop")
    else labels.push("× shorted trace")
  }
  return labels
}

/** Draw one attempted simulation with a separate centered text band. */
export function planDrawing(scene: PlanVisualScene): GraphicsObject {
  const { db, scope, faultPorts } = scene
  const board = routeBoardBox(db)
  const ports = planPorts(db)
  const active = new Set([
    ...scene.endpoints.map((end) => end.id),
    ...faultPorts,
  ])
  for (const { from, to } of [...scene.cuts, ...scene.links]) {
    active.add(from)
    active.add(to)
  }
  const scopeBox = scope && planScopeBox({ db, board, scope, active, ports })
  const frame = planFrame({ board, focus: scopeBox })
  const { unit, crop } = frame
  const copper = drawCopper({ scene, ports, unit })
  const lines = [...copper.lines]
  if (scopeBox) lines.push(scopeLine({ scope: scopeBox, board, unit }))
  const polygons = [
    ...planBoardShapes({ db, board, active, ports, unit }),
    ...viaShapes({ db, scope, unit }),
    ...copper.chevrons,
  ]
  for (const link of scene.links) {
    if (
      link.kind === "ideal" &&
      scene.links.some(
        ({ kind, from, to }) =>
          kind === "short" && from === link.from && to === link.to,
      )
    )
      continue
    const from = ports.get(link.from)
    const to = ports.get(link.to)
    if (!from || !to) continue
    lines.push(linkLine({ link, from, to, unit }))
    polygons.push(...linkShapes({ link, from, to, unit }))
  }
  const radius = endpointRadius({
    unit,
    ports: [...ports.values()].filter((port) => active.has(port.id)),
  })
  for (const endpoint of scene.endpoints) {
    const point = ports.get(endpoint.id)
    if (point && !faultPorts.has(endpoint.id))
      polygons.push(...endpointShape({ point, endpoint, radius, ports }))
  }
  polygons.push(...copper.faults)
  for (const id of faultPorts) {
    const port = ports.get(id)
    if (!port) continue
    const label = `Offending port · ${port.label} (${id})`
    polygons.push(
      {
        points: ring({ center: port, radius: radius * 1.08 }),
        fill: "#fff",
        stroke: planColors.failure,
        strokeWidth: radius * 0.34,
        label,
        layer: "failure",
      },
      {
        points: ring({ center: port, radius: radius * 0.36 }),
        fill: planColors.failure,
        stroke: "none",
        label,
        layer: "failure",
      },
    )
  }
  const boardPolygons = clipPlanPolygons({ polygons, crop })
  const boardLines = clipPlanLines({ lines, crop })
  const labels = planLabels({
    scene,
    frame,
    ports,
    radius,
    polygons: boardPolygons,
    lines: boardLines,
  })
  const extent = routeBounds([
    ...labels.backgrounds.flatMap(({ points }) => points),
    ...labels.texts,
    ...boardPolygons.flatMap(({ points }) => points),
    ...boardLines.flatMap(({ points }) => points),
    ...boxPoints(frame.box),
  ])
  const rows = [...scene.rows]
  if (scene.summary) {
    const { text, scopedText } = scene.summary
    let summary = text
    if (
      scopedText &&
      scopeBox &&
      (scopeBox.minX > board.minX ||
        scopeBox.maxX < board.maxX ||
        scopeBox.minY > board.minY ||
        scopeBox.maxY < board.maxY)
    )
      summary = scopedText
    rows.unshift({ text: summary, color: planColors.quiet })
  }
  const header = planHeader({
    scene: { ...scene, rows },
    frame,
    boardTop: extent?.maxY === undefined ? frame.box.maxY : extent.maxY,
    legend: [
      ...planLegend({ scene, polygons: boardPolygons, lines: boardLines }),
      ...labels.pourLegend,
    ],
  })
  return {
    title: scene.title,
    coordinateSystem: "cartesian",
    lines: [...boardLines, ...labels.leaders, ...header.lines],
    polygons: [...boardPolygons, ...labels.backgrounds],
    texts: [...labels.texts, ...header.texts],
    rects: header.rects,
  }
}
