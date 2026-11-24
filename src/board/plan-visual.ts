import type { GraphicsObject, Viewbox } from "graphics-debug"
import { drawCopper } from "./plan-copper"
import { buildPlanHeader } from "./plan-header"
import { placePlanLabels } from "./plan-labels"
import {
  endpointRadius,
  endpointShape,
  linkLine,
  linkShapes,
  ring,
  viaShapes,
} from "./plan-marks"
import { buildBoardShapes } from "./plan-shapes"
import {
  boxPoints,
  buildPlanFrame,
  clipPlanLines,
  clipPlanPolygons,
  getBoardBounds,
  getCopperSearchBox,
  getPointBounds,
} from "./plan-view"
import {
  type PlanLine,
  type PlanPolygon,
  type PlanVisualScene,
  planColors,
} from "./plan-visual-types"

/** Scope envelope, separated from the board outline when fully in scope. */
function buildSearchEnvelope({
  scope,
  board,
  unitMm,
}: {
  scope: Viewbox
  board: Viewbox
  unitMm: number
}): PlanLine {
  const inset = unitMm * 0.6
  const points = boxPoints({
    minX: Math.max(board.minX + inset, scope.minX),
    maxX: Math.min(board.maxX - inset, scope.maxX),
    minY: Math.max(board.minY + inset, scope.minY),
    maxY: Math.min(board.maxY - inset, scope.maxY),
  })
  return {
    points: [...points, points[0]],
    strokeColor: planColors.scope,
    strokeWidth: unitMm * 0.37,
    strokeDash: "4,4",
    mark: "envelope",
    layer: "scope",
    label: "Copper search envelope",
  }
}

/** Explain only the symbols that were drawn inside the board window. */
function buildPlanLegend({
  scene,
  polygons,
  lines,
}: {
  scene: PlanVisualScene
  polygons: readonly PlanPolygon[]
  lines: readonly PlanLine[]
}): string[] {
  const kinds = new Set(polygons.map(({ endpointKind }) => endpointKind))
  const lineMarks = new Set(lines.map(({ mark }) => mark))
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
  if (lineMarks.has("ideal")) labels.push("-- ideal connection")
  if (lineMarks.has("envelope")) labels.push("▪▪ copper search envelope")
  if (lineMarks.has("missing")) labels.push("-×- incomplete route")
  const hasBypass = lineMarks.has("bypass")
  if (hasBypass) labels.push("-×- bypass")
  if (lineMarks.has("traceFault")) {
    if (hasBypass) labels.push("× bypassed trace")
    else if (scene.faultCode === "channel_fanout")
      labels.push("× trace in loop")
    else labels.push("× shorted trace")
  }
  return labels
}

/** The lines and symbols for ideal, series and fault connections. */
interface PlanOverlays {
  lines: PlanLine[]
  polygons: PlanPolygon[]
}

/** Resolve overlay endpoints and keep bypasses above the corresponding ideal connection. */
function renderOverlays({
  scene,
  unitMm,
}: {
  scene: PlanVisualScene
  unitMm: number
}): PlanOverlays {
  const { ports } = scene
  const lines: PlanLine[] = []
  const polygons: PlanPolygon[] = []
  for (const link of scene.overlays) {
    if (
      link.kind === "ideal" &&
      scene.overlays.some(
        ({ kind, fromSourcePortId, toSourcePortId }) =>
          kind === "short" &&
          fromSourcePortId === link.fromSourcePortId &&
          toSourcePortId === link.toSourcePortId,
      )
    )
      continue
    const from = ports.get(link.fromSourcePortId)
    const to = ports.get(link.toSourcePortId)
    if (!from || !to) continue
    const line: PlanLine = linkLine({ link, from, to, unitMm })
    if (link.kind === "ideal" || link.kind === "missing") line.mark = link.kind
    if (link.kind === "short") line.mark = "bypass"
    lines.push(line)
    polygons.push(...linkShapes({ link, from, to, unitMm }))
  }
  return { lines, polygons }
}

/** Draw declared endpoints and replace faulted endpoint glyphs with fault markers. */
function renderContactMarks({
  scene,
  radius,
  traceFaults,
}: {
  scene: PlanVisualScene
  radius: number
  traceFaults: readonly PlanPolygon[]
}): PlanPolygon[] {
  const { ports, faultSourcePortIds } = scene
  const polygons: PlanPolygon[] = []
  for (const endpoint of scene.endpoints) {
    const point = ports.get(endpoint.sourcePortId)
    if (point && !faultSourcePortIds.has(endpoint.sourcePortId))
      polygons.push(
        ...endpointShape({ point, endpoint, radius, ports }).map((shape) => ({
          ...shape,
          endpointKind: endpoint.kind,
        })),
      )
  }
  polygons.push(...traceFaults)
  for (const id of faultSourcePortIds) {
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
  return polygons
}

/** Draw one attempted simulation with a separate centered text band. */
export function renderPlanDrawing(scene: PlanVisualScene): GraphicsObject {
  const { db, copperScope, faultSourcePortIds, ports } = scene
  const board = getBoardBounds(db)
  const active = new Set([
    ...scene.endpoints.map((end) => end.sourcePortId),
    ...faultSourcePortIds,
  ])
  for (const { fromSourcePortId, toSourcePortId } of [
    ...scene.traces,
    ...scene.overlays,
  ]) {
    active.add(fromSourcePortId)
    active.add(toSourcePortId)
  }
  const scopeBox =
    copperScope &&
    getCopperSearchBox({ db, board, scope: copperScope, active, ports })
  const frame = buildPlanFrame({ board, focus: scopeBox })
  const { unitMm, crop } = frame
  const copper = drawCopper({ scene, ports, unitMm })
  const lines = [...copper.lines]
  if (scopeBox)
    lines.push(buildSearchEnvelope({ scope: scopeBox, board, unitMm }))
  const polygons: PlanPolygon[] = [
    ...buildBoardShapes({ db, board, active, ports, unitMm }),
    ...viaShapes({ db, copperScope, unitMm }),
    ...copper.chevrons,
  ]
  const overlays = renderOverlays({ scene, unitMm })
  lines.push(...overlays.lines)
  polygons.push(...overlays.polygons)
  const radius = endpointRadius({
    unitMm,
    ports: [...ports.values()].filter(({ sourcePortId }) =>
      active.has(sourcePortId),
    ),
  })
  polygons.push(
    ...renderContactMarks({ scene, radius, traceFaults: copper.faults }),
  )
  const boardPolygons = clipPlanPolygons({ polygons, crop })
  const boardLines = clipPlanLines({ lines, crop })
  const labels = placePlanLabels({
    scene,
    frame,
    ports,
    radius,
    polygons: boardPolygons,
    lines: boardLines,
  })
  const extent = getPointBounds([
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
  let boardTop = frame.box.maxY
  if (extent) boardTop = extent.maxY
  const header = buildPlanHeader({
    scene: { ...scene, rows },
    frame,
    boardTop,
    legend: [
      ...buildPlanLegend({ scene, polygons: boardPolygons, lines: boardLines }),
      ...labels.pourLegendEntries,
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
