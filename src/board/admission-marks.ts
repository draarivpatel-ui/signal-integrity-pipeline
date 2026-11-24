import type { Line, Point, Polygon } from "graphics-debug"
import type { AdmissionPort } from "./admission-view"
import {
  type AdmissionVisualEndpoint,
  type AdmissionVisualLink,
  type AdmissionVisualScene,
  admissionColors,
} from "./admission-visual-types"
import type { SourcePortId } from "./ids"

/** A directed segment with a perpendicular for ticks, arrowheads and fault crosses. */
interface AdmissionDirection {
  x: number
  y: number
  length: number
}

/** Normalize direction, with a right-facing glyph for coincident or unplaced targets. */
export function direction({
  from,
  to,
}: {
  from: Point
  to?: Point
}): AdmissionDirection {
  if (!to) return { x: 1, y: 0, length: 0 }
  const x = to.x - from.x
  const y = to.y - from.y
  const length = Math.hypot(x, y)
  if (length === 0) return { x: 1, y: 0, length }
  return { x: x / length, y: y / length, length }
}

/** Place a point relative to a directed glyph's center. */
export function offset({
  point,
  axis,
  along = 0,
  across = 0,
}: {
  point: Point
  axis: AdmissionDirection
  along?: number
  across?: number
}): Point {
  return {
    x: point.x + axis.x * along - axis.y * across,
    y: point.y + axis.y * along + axis.x * across,
  }
}

/** Board-aligned circle points used for the filled ring and its white center. */
export function ring({
  center,
  radius,
}: {
  center: Point
  radius: number
}): Point[] {
  return Array.from({ length: 24 }, (_, i) => {
    const angle = (i * Math.PI) / 12
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    }
  })
}

/** Draw both explicit vias and inline route vias without duplicate holes. */
export function viaShapes({
  db,
  scope,
  unit,
}: Pick<AdmissionVisualScene, "db" | "scope"> & { unit: number }): Polygon[] {
  const selected = new Set(scope?.extractedPcbViaIds)
  const boardVias = db.pcb_via.list().map((via) => ({
    ...via,
    label: `Via ${via.pcb_via_id} · ${via.layers.join("–")}`,
    active: selected.has(via.pcb_via_id),
  }))
  const positions = new Set(boardVias.map(({ x, y }) => `${x},${y}`))
  const nearby = new Set(scope?.extractedPcbTraceIds)
  const routeVias = db.pcb_trace.list().flatMap((trace) =>
    trace.route.flatMap((point) => {
      if (point.route_type !== "via") return []
      const key = `${point.x},${point.y}`
      if (positions.has(key)) return []
      positions.add(key)
      return [
        {
          ...point,
          outer_diameter: point.outer_diameter || unit * 2,
          hole_diameter: point.hole_diameter || unit,
          active: nearby.has(trace.pcb_trace_id),
          label: `Route via · ${point.from_layer}–${point.to_layer}`,
        },
      ]
    }),
  )
  return [...boardVias, ...routeVias].flatMap((via) => {
    const fill = via.active ? admissionColors.scope : "#64748b"
    return [
      {
        points: ring({ center: via, radius: via.outer_diameter / 2 }),
        fill,
        stroke: "#334155",
        strokeWidth: unit * 0.18,
        label: via.label,
        layer: "copper",
      },
      {
        points: ring({ center: via, radius: via.hole_diameter / 2 }),
        fill: "#fff",
        stroke: "none",
        label: via.label,
        layer: "copper",
      },
    ]
  })
}

/** A glyph radius that fits the two closest distinct active contacts. */
export function endpointRadius({
  ports,
  unit,
}: {
  ports: readonly Point[]
  unit: number
}): number {
  let radius = unit * 1.42
  for (const [index, from] of ports.entries())
    for (const to of ports.slice(index + 1)) {
      const { length } = direction({ from, to })
      if (length > 0) radius = Math.min(radius, length * 0.38)
    }
  return radius
}

/** Triangle, white-center receiver target, or open diamond. */
export function endpointShape({
  point,
  endpoint,
  radius,
  ports,
}: {
  point: AdmissionPort
  endpoint: AdmissionVisualEndpoint
  radius: number
  ports: ReadonlyMap<SourcePortId, AdmissionPort>
}): Polygon[] {
  const { kind, label, color, toward } = endpoint
  const layer = "endpoints"
  if (kind === "driver") {
    const axis = direction({ from: point, to: ports.get(toward || "") })
    const points = [
      [1, 0],
      [-0.78, 0.88],
      [-0.78, -0.88],
    ].map(([along, across]) =>
      offset({ point, axis, along: along * radius, across: across * radius }),
    )
    return [
      {
        points,
        fill: "#fff",
        stroke: "#fff",
        strokeWidth: radius * 0.62,
        layer,
        label,
      },
      {
        points,
        fill: color,
        stroke: admissionColors.ink,
        strokeWidth: radius * 0.17,
        layer,
        label,
      },
    ]
  }
  if (kind === "receiver")
    return [
      {
        points: ring({ center: point, radius: radius * 1.19 }),
        fill: "#fff",
        stroke: "none",
        layer,
        label,
      },
      {
        points: ring({ center: point, radius: radius * 0.85 }),
        fill: "#fff",
        stroke: color,
        strokeWidth: radius * 0.33,
        layer,
        label,
      },
      {
        points: ring({ center: point, radius: radius * 0.23 }),
        fill: color,
        stroke: "none",
        layer,
        label,
      },
    ]
  const size = kind === "load" ? radius * 0.8 : radius
  return [
    {
      points: [
        { x: point.x + size, y: point.y },
        { x: point.x, y: point.y + size },
        { x: point.x - size, y: point.y },
        { x: point.x, y: point.y - size },
      ],
      fill: "#fff",
      stroke: color,
      strokeWidth: radius * 0.25,
      layer,
      label,
    },
  ]
}

/** A contrasting cross marks the middle of a gap or implicated connection. */
export function faultCross({
  point,
  unit,
  label,
}: {
  point: Point
  unit: number
  label: string
}): Polygon {
  const ends = [
    [-1, -0.65],
    [-0.65, -1],
    [0, -0.35],
    [0.65, -1],
    [1, -0.65],
    [0.35, 0],
    [1, 0.65],
    [0.65, 1],
    [0, 0.35],
    [-0.65, 1],
    [-1, 0.65],
    [-0.35, 0],
  ]
  return {
    points: ends.map(([x, y]) => ({
      x: point.x + x * unit,
      y: point.y + y * unit,
    })),
    fill: admissionColors.failure,
    stroke: "#fff",
    strokeWidth: unit * 0.22,
    label,
    layer: "failure",
  }
}

/** Raise the conceptual bypass off the physical trace between the same terminals. */
function bypassPoints({
  from,
  to,
  unit,
}: {
  from: Point
  to: Point
  unit: number
}): Point[] {
  const axis = direction({ from, to })
  const rise = Math.min(axis.length / 4, unit * 5)
  const side = axis.x < 0 ? -1 : 1
  return [
    from,
    offset({ point: from, axis, along: axis.length / 2, across: rise * side }),
    to,
  ]
}

/** Physical passives connect their pads through a framed body. */
export function linkShapes({
  link,
  from,
  to,
  unit,
}: {
  link: AdmissionVisualLink
  from: Point
  to: Point
  unit: number
}): Polygon[] {
  const { kind, label } = link
  const axis = direction({ from, to })
  const point = offset({ point: from, axis, along: axis.length / 2 })
  if (kind === "short")
    return [
      faultCross({ point: bypassPoints({ from, to, unit })[1], unit, label }),
    ]
  if (kind === "missing") return [faultCross({ point, unit, label })]
  if (kind !== "series" || axis.length === 0) return []
  const half = axis.length / 2
  const points = [
    [-half, -unit],
    [half, -unit],
    [half, unit],
    [-half, unit],
  ].map(([along, across]) => offset({ point, axis, along, across }))
  return [
    {
      points,
      fill: "rgba(254,243,199,0.24)",
      stroke: admissionColors.series,
      strokeWidth: unit * 0.32,
      label,
      layer: "topology",
    },
  ]
}

/** Dashed joins, amber series bridges and red failure overlays. */
export function linkLine({
  link,
  from,
  to,
  unit,
}: {
  link: AdmissionVisualLink
  from: Point
  to: Point
  unit: number
}): Line {
  const { kind, label } = link
  if (kind === "series") {
    const axis = direction({ from, to })
    const points = [0, 0.24, 0.37, 0.5, 0.63, 0.76, 1].map((fraction, i) =>
      offset({
        point: from,
        axis,
        along: fraction * axis.length,
        across: [0, 0, 0.52, -0.52, 0.52, 0, 0][i] * unit,
      }),
    )
    return {
      points,
      label,
      layer: "topology",
      strokeColor: admissionColors.series,
      strokeWidth: unit * 0.55,
      zIndex: 3,
    }
  }
  if (kind === "ideal")
    return {
      points: [from, to],
      label,
      layer: "topology",
      strokeColor: admissionColors.ideal,
      strokeWidth: unit * 0.68,
      strokeDash: "7,4",
      zIndex: 3,
    }
  let points = [from, to]
  if (kind === "short") points = bypassPoints({ from, to, unit })
  return {
    points,
    label,
    layer: "failure",
    strokeColor: admissionColors.failure,
    strokeWidth: unit * 0.63,
    strokeDash: "6,4",
    zIndex: 4,
  }
}
