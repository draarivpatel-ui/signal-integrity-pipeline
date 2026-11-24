import type { LayerRef, PcbTrace } from "circuit-json"
import type { Line, Point, Polygon } from "graphics-debug"
import type { SourcePortId } from "./ids"
import { direction, faultCross, offset } from "./plan-marks"
import type { PlanPort } from "./plan-view"
import {
  type PlanVisualCut,
  type PlanVisualScene,
  planColors,
  planCutColor,
} from "./plan-visual-types"

/** A run of copper sharing a layer and width. */
interface PlanWire {
  points: Point[]
  width: number
  layer: LayerRef
}

/** Break at layer or width changes while preserving connections to vias and pads. */
function planWires(trace: PcbTrace): PlanWire[] {
  const wires: PlanWire[] = []
  for (const [index, end] of trace.route.slice(1).entries()) {
    const start = trace.route[index]
    const wire = start.route_type === "wire" ? start : end
    if (wire.route_type !== "wire") continue
    const a = start.route_type === "through_pad" ? start.end : start
    const b = end.route_type === "through_pad" ? end.start : end
    if (a.x === b.x && a.y === b.y) continue
    const width = Math.max(wire.width, wire.end_width || wire.width)
    const previous = wires.at(-1)
    const last = previous?.points.at(-1)
    if (
      previous?.layer === wire.layer &&
      previous.width === width &&
      last?.x === a.x &&
      last.y === a.y
    )
      previous.points.push(b)
    else wires.push({ points: [a, b], width, layer: wire.layer })
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
  const { db, scope, existingTraces } = scene
  const nearby = new Set(scope?.extractedPcbTraceIds)
  const rails = new Set(scope?.nearbyRailPcbTraceIds)
  const channel = new Set(scope?.channelPcbTraceIds)
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
      if (channel.has(id) || existingTraces.has(source))
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
      else if (!scope && !scene.diagnostic)
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
  cut: PlanVisualCut
  label: string
}): Line[] {
  const { points, width, layer } = wire
  const line: Line = {
    points,
    strokeWidth: width * (cut.mapped ? 1 : 0.7),
    strokeColor: planCutColor(cut.index),
    label: `${label} · ${layer}`,
    layer: "cuts",
    zIndex: 2,
  }
  if (layer === "top") return [line]
  if (layer === "bottom")
    return [
      { ...line, strokeColor: "#cbd5e1", strokeWidth: width },
      { ...line, strokeDash: "10,4" },
    ]
  return [line, { ...line, strokeColor: "#fff", strokeWidth: width * 0.18 }]
}

/** Cut ticks sit just inside the partition, away from the endpoint glyphs. */
function cutTicks({
  wires,
  unit,
  label,
  color,
}: {
  wires: readonly PlanWire[]
  unit: number
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
      along: Math.min(unit * 2.2, axis.length * 0.32),
    })
    const width = Math.max(unit, first.width * 0.9)
    const points = [-width, width].map((across) =>
      offset({ point, axis, across }),
    )
    return [
      {
        points,
        strokeWidth: unit * 0.62,
        strokeColor: "#fff",
        label,
        layer: "cuts",
        zIndex: 3,
      },
      {
        points,
        strokeWidth: unit * 0.29,
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
  unit,
  label,
  color,
}: {
  wires: readonly PlanWire[]
  from?: Point
  unit: number
  label: string
  color: string
}): Polygon[] {
  const first = wires[0]?.points[0]
  const last = wires.at(-1)?.points.at(-1)
  if (!first || !last) return []
  let reverse = false
  if (from)
    reverse =
      direction({ from, to: first }).length >
      direction({ from, to: last }).length
  const segments = wires.flatMap(({ points }) =>
    points.slice(1).map((to, i) => {
      const start = points[i]
      if (reverse)
        return { start: to, axis: direction({ from: to, to: start }) }
      return { start, axis: direction({ from: start, to }) }
    }),
  )
  if (reverse) segments.reverse()
  const total = segments.reduce(
    (length, segment) => length + segment.axis.length,
    0,
  )
  const count = Math.floor(total / (unit * 8)) + 1
  if (total < unit * 5) return []
  let traversed = 0
  let next = total / (count + 1)
  const shapes: Polygon[] = []
  for (const { start, axis } of segments) {
    while (next <= traversed + axis.length && next < total - unit) {
      const point = offset({ point: start, axis, along: next - traversed })
      const points = [
        [-0.7, -0.68],
        [0.16, 0],
        [-0.7, 0.68],
        [-0.16, 0.68],
        [0.7, 0],
        [-0.16, -0.68],
      ].map(([along, across]) =>
        offset({ point, axis, along: along * unit, across: across * unit }),
      )
      shapes.push({
        points,
        fill: color,
        stroke: "#fff",
        strokeWidth: unit * 0.23,
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
  lines: Line[]
  chevrons: Polygon[]
  faults: Polygon[]
}

/** Build trace layers in copper order; diagnostic paths retain the real trace vertices. */
export function drawCopper({
  scene,
  ports,
  unit,
}: {
  scene: PlanVisualScene
  ports: ReadonlyMap<SourcePortId, PlanPort>
  unit: number
}): PlanCopperDrawing {
  const lines: Line[] = []
  const chevrons: Polygon[] = []
  const faults: Polygon[] = []
  const styles = copperStyles(scene)
  const cuts = new Map(scene.cuts.map((cut) => [cut.trace, cut]))
  for (const trace of scene.db.pcb_trace.list()) {
    const id = trace.source_trace_id || trace.pcb_trace_id
    const cut = cuts.get(id)
    const wires = planWires(trace)
    const style = styles.get(trace.pcb_trace_id)
    if (cut) {
      const label = `C${cut.index + 1} · ${ports.get(cut.from)?.label || cut.from} → ${ports.get(cut.to)?.label || cut.to}`
      lines.push(...wires.flatMap((wire) => cutStrokes({ wire, cut, label })))
      const color = planCutColor(cut.index)
      lines.push(...cutTicks({ wires, unit, label, color }))
      if (cut.mapped)
        chevrons.push(
          ...mappingChevrons({
            wires,
            from: ports.get(cut.from),
            unit,
            label: `Mapped path · ${label}`,
            color,
          }),
        )
    } else {
      lines.push(
        ...wires.map(({ points, width }) => ({
          points,
          strokeWidth: width,
          ...style,
        })),
      )
    }
    if (!scene.faultTraces.has(id)) continue
    const label = `Short or loop · ${id}`
    for (const { points, width } of wires)
      lines.push({
        points,
        strokeColor: planColors.failure,
        strokeWidth: Math.max(width, unit * 0.64),
        strokeDash: "6,3",
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
        unit,
        label,
      }),
    )
  }
  return { lines, chevrons, faults }
}
