import type { GraphicsObject, Line, Viewbox } from "graphics-debug"
import { drawCopper } from "./plan-copper"
import { planHeader } from "./plan-header"
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
    label: "Copper scope envelope",
  }
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
  const extent = routeBounds([
    ...boardPolygons.flatMap(({ points }) => points),
    ...boardLines.flatMap(({ points }) => points),
    ...boxPoints(frame.box),
  ])
  const header = planHeader({
    scene,
    frame,
    board,
    boardTop: extent?.maxY === undefined ? frame.box.maxY : extent.maxY,
    scopeBox,
  })
  return {
    title: scene.title,
    coordinateSystem: "cartesian",
    lines: [...boardLines, ...header.lines],
    polygons: boardPolygons,
    texts: header.texts,
    rects: header.rects,
  }
}
