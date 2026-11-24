import type { LayerRef, PcbTrace } from "circuit-json"
import type { Line, Point, Polygon } from "graphics-debug"
import type { SourcePortId } from "./ids"
import { direction, faultCross, offset } from "./plan-marks"
import type { PlanPort } from "./plan-view"
import {
  getTraceColor,
  type PlanLine,
  type PlanTrace,
  type PlanVisualScene,
  planColors,
} from "./plan-visual-types"

/** A run of copper sharing a layer and width. */
interface PlanWire {
  points: Point[]
  strokeWidthMm: number
  layer: LayerRef
}

/** Break at layer or width changes while preserving connections to vias and pads. */
function planWires(trace: PcbTrace): PlanWire[] {
  const wires: PlanWire[] = []
  for (const [index, end] of trace.route.slice(1).entries()) {
    const start = trace.route[index]
    let wire = end
    if (start.route_type === "wire") wire = start
    if (wire.route_type !== "wire") continue
    let a: Point = start as Point
    if (start.route_type === "through_pad") a = start.end
    let b: Point = end as Point
    if (end.route_type === "through_pad") b = end.start
    if (a.x === b.x && a.y === b.y) continue
    const strokeWidthMm = Math.max(wire.width, wire.end_width || wire.width)
    const previous = wires.at(-1)
    const last = previous?.points.at(-1)
    if (
      previous?.layer === wire.layer &&
      previous.strokeWidthMm === strokeWidthMm &&
      last?.x === a.x &&
      last.y === a.y
    )
      previous.points.push(b)
    else wires.push({ points: [a, b], strokeWidthMm, layer: wire.layer })
  }
  return wires
}

/** Out-of-scope, nearby rail, nearby signal and selected copper have distinct styling. */
interface PlanCopperStyle {
  strokeColor: string
  label: string
  layer: string
  zIndex: number
  strokeDash?: string
}

/** Resolve per-trace scope membership once before rendering its wire runs. */
function copperStyles(scene: PlanVisualScene): Map<string, PlanCopperStyle> {
  const { db, copperScope, existingSourceTraceIds } = scene
  const nearby = new Set(copperScope?.extractedPcbTraceIds)
  const rails = new Set(copperScope?.nearbyRailPcbTraceIds)
  const channel = new Set(copperScope?.channelPcbTraceIds)
  return new Map(
    db.pcb_trace.list().map((trace) => {
      const id = trace.pcb_trace_id
      const source = trace.source_trace_id || id
      let style: PlanCopperStyle = {
        strokeColor: planColors.excluded,
        label: `Out of scope · ${source}`,
        layer: "board",
        zIndex: 0,
      }
      if (channel.has(id) || existingSourceTraceIds.has(source))
        style = {
          strokeColor: planColors.existing,
          label: `Routed copper · ${source}`,
          layer: "cuts",
          zIndex: 2,
        }
      else if (rails.has(id))
        style = {
          strokeColor: planColors.rail,
          label: `Nearby rail · ${source}`,
          layer: "scope",
          zIndex: 1,
        }
      else if (nearby.has(id))
        style = {
          strokeColor: planColors.nearby,
          label: `Nearby signal · ${source}`,
          layer: "scope",
          zIndex: 1,
          strokeDash: "10,3",
        }
      else if (!copperScope && !scene.diagnostic)
        style = { ...style, label: `Board copper · ${source}` }
      return [id, style]
    }),
  )
}

/** A cut stroke encodes the PCB layer without relying on SVG arrow scaling. */
function cutStrokes({
  wire,
  cut,
  label,
}: {
  wire: PlanWire
  cut: PlanTrace
  label: string
}): Line[] {
  const { points, strokeWidthMm, layer } = wire
  let traceStrokeWidthMm = strokeWidthMm
  if (!cut.isMapped) traceStrokeWidthMm *= 0.7
  const line: Line = {
    points,
    strokeWidth: traceStrokeWidthMm,
    strokeColor: getTraceColor(cut.index),
    label: `${label} · ${layer}`,
    layer: "cuts",
    zIndex: 2,
  }
  if (layer === "top") return [line]
  if (layer === "bottom")
    return [
      { ...line, strokeColor: "#cbd5e1", strokeWidth: strokeWidthMm },
      { ...line, strokeDash: "10,4" },
    ]
  return [
    line,
    { ...line, strokeColor: "#fff", strokeWidth: strokeWidthMm * 0.18 },
  ]
}

/** Cut ticks sit just inside the partition, away from the endpoint glyphs. */
function cutTicks({
  wires,
  unitMm,
  label,
  color,
}: {
  wires: readonly PlanWire[]
  unitMm: number
  label: string
  color: string
}): Line[] {
  const first = wires[0]
  const last = wires.at(-1)
  if (!first || !last) return []
  return [
    [first.points[0], first.points[1]],
    [last.points[last.points.length - 1], last.points[last.points.length - 2]],
  ].flatMap(([from, to]) => {
    const axis = direction({ from, to })
    if (axis.length === 0) return []
    const point = offset({
      point: from,
      axis,
      along: Math.min(unitMm * 2.2, axis.length * 0.32),
    })
    const width = Math.max(unitMm, first.strokeWidthMm * 0.9)
    const points = [-width, width].map((across) =>
      offset({ point, axis, across }),
    )
    return [
      {
        points,
        strokeWidth: unitMm * 0.62,
        strokeColor: "#fff",
        label,
        layer: "cuts",
        zIndex: 3,
      },
      {
        points,
        strokeWidth: unitMm * 0.29,
        strokeColor: color,
        label,
        layer: "cuts",
        zIndex: 3,
      },
    ]
  })
}

/** Directional chevrons spaced across each cut, independent of wire vertices. */
function mappingChevrons({
  wires,
  from,
  unitMm,
  label,
  color,
}: {
  wires: readonly PlanWire[]
  from?: Point
  unitMm: number
  label: string
  color: string
}): Polygon[] {
  const first = wires[0]?.points[0]
  const last = wires.at(-1)?.points.at(-1)
  if (!first || !last) return []
  let isReversed = false
  if (from)
    isReversed =
      direction({ from, to: first }).length >
      direction({ from, to: last }).length
  const segments = wires.flatMap(({ points }) =>
    points.slice(1).map((to, i) => {
      const start = points[i]
      if (isReversed)
        return { start: to, axis: direction({ from: to, to: start }) }
      return { start, axis: direction({ from: start, to }) }
    }),
  )
  if (isReversed) segments.reverse()
  const total = segments.reduce(
    (length, segment) => length + segment.axis.length,
    0,
  )
  const count = Math.floor(total / (unitMm * 8)) + 1
  if (total < unitMm * 5) return []
  let traversed = 0
  let next = total / (count + 1)
  const shapes: Polygon[] = []
  for (const { start, axis } of segments) {
    while (next <= traversed + axis.length && next < total - unitMm) {
      const point = offset({ point: start, axis, along: next - traversed })
      const points = [
        [-0.7, -0.68],
        [0.16, 0],
        [-0.7, 0.68],
        [-0.16, 0.68],
        [0.7, 0],
        [-0.16, -0.68],
      ].map(([along, across]) =>
        offset({ point, axis, along: along * unitMm, across: across * unitMm }),
      )
      shapes.push({
        points,
        fill: color,
        stroke: "#fff",
        strokeWidth: unitMm * 0.23,
        layer: "mappings",
        label,
      })
      next += total / (count + 1)
    }
    traversed += axis.length
  }
  return shapes
}

/** The physical copper plus cut and path overlays. */
interface PlanCopperDrawing {
  lines: PlanLine[]
  chevrons: Polygon[]
  faults: Polygon[]
}

/** Build trace layers in copper order; diagnostic paths retain the real trace vertices. */
export function drawCopper({
  scene,
  ports,
  unitMm,
}: {
  scene: PlanVisualScene
  ports: ReadonlyMap<SourcePortId, PlanPort>
  unitMm: number
}): PlanCopperDrawing {
  const lines: PlanLine[] = []
  const chevrons: Polygon[] = []
  const faults: Polygon[] = []
  const styles = copperStyles(scene)
  const cuts = new Map(scene.traces.map((cut) => [cut.sourceTraceId, cut]))
  for (const trace of scene.db.pcb_trace.list()) {
    const id = trace.source_trace_id || trace.pcb_trace_id
    const cut = cuts.get(id)
    const wires = planWires(trace)
    const style = styles.get(trace.pcb_trace_id)
    if (cut) {
      const label = `Trace ${cut.index + 1} · ${ports.get(cut.fromSourcePortId)?.label || cut.fromSourcePortId} → ${ports.get(cut.toSourcePortId)?.label || cut.toSourcePortId}`
      lines.push(...wires.flatMap((wire) => cutStrokes({ wire, cut, label })))
      const color = getTraceColor(cut.index)
      lines.push(...cutTicks({ wires, unitMm, label, color }))
      if (cut.isMapped)
        chevrons.push(
          ...mappingChevrons({
            wires,
            from: ports.get(cut.fromSourcePortId),
            unitMm,
            label: `Receiver path · ${label}`,
            color,
          }),
        )
    } else {
      lines.push(
        ...wires.map(({ points, strokeWidthMm }) => ({
          points,
          strokeWidth: strokeWidthMm,
          ...style,
        })),
      )
    }
    if (!scene.faultSourceTraceIds.has(id)) continue
    const label = `Short or loop · ${id}`
    for (const { points, strokeWidthMm } of wires)
      lines.push({
        points,
        strokeColor: planColors.failure,
        strokeWidth: Math.max(strokeWidthMm, unitMm * 0.64),
        strokeDash: "6,3",
        mark: "traceFault",
        zIndex: 4,
        layer: "failure",
        label,
      })
    const middle = wires.at(Math.floor(wires.length / 2))
    if (!middle) continue
    const i = Math.floor((middle.points.length - 1) / 2)
    const from = middle.points[i]
    const axis = direction({ from, to: middle.points[i + 1] })
    faults.push(
      faultCross({
        point: offset({ point: from, axis, along: axis.length / 2 }),
        unitMm,
        label,
      }),
    )
  }
  return { lines, chevrons, faults }
}
