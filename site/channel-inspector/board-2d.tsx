import type { LayerRef, Point } from "circuit-json"
import type React from "react"
import type { BoardInteraction } from "./board-3d"
import {
  copperStyles,
  type InspectorBoard,
  type InspectorFeature,
  type InspectorShape,
} from "./geometry"

/** Leave a little breathing room around the physical outline. */
const BOARD_MARGIN_MM = 0.8

/** Draw closed SVG rings, retaining internal voids under the even-odd fill rule. */
function ringPath(rings: readonly (readonly Point[])[]): string {
  return rings
    .map((ring) => `M ${ring.map(({ x, y }) => `${x} ${y}`).join(" L ")} Z`)
    .join(" ")
}

/** Draw the same copper primitives and colors used by the 3D view. */
function CopperShape({
  shape,
  color,
}: {
  shape: InspectorShape
  color: string
}): React.JSX.Element {
  if (shape.shape === "wire")
    return (
      <line
        x1={shape.start.x}
        y1={shape.start.y}
        x2={shape.end.x}
        y2={shape.end.y}
        stroke={color}
        strokeWidth={shape.width}
        strokeLinecap="round"
      />
    )
  if (shape.shape === "via")
    return (
      <circle
        cx={shape.center.x}
        cy={shape.center.y}
        r={shape.diameter / 2}
        fill={color}
      />
    )
  return <path d={ringPath(shape.rings)} fill={color} fillRule="evenodd" />
}

/** Project the physical board onto XY with independently toggleable layers. */
export function Board2d({
  board,
  features,
  layers,
  hovered,
  selected,
  onHover,
  onSelect,
  onCursor,
  onContext,
  themed,
}: BoardInteraction & {
  board: InspectorBoard
  features: readonly InspectorFeature[]
  layers: ReadonlySet<LayerRef>
  themed?: boolean
}): React.JSX.Element {
  const { center, width, height } = board
  const viewBox = [
    center.x - width / 2 - BOARD_MARGIN_MM,
    -center.y - height / 2 - BOARD_MARGIN_MM,
    width + 2 * BOARD_MARGIN_MM,
    height + 2 * BOARD_MARGIN_MM,
  ].join(" ")
  const ordered = [...features].sort(
    (left, right) =>
      copperStyles[left.category].order - copperStyles[right.category].order,
  )
  return (
    <svg
      className="inspector-board-2d"
      viewBox={viewBox}
      aria-label="Top view of PCB copper"
      onClick={() => onSelect(undefined)}
      onPointerMove={(event) => {
        if (!onCursor) return
        const matrix = event.currentTarget.getScreenCTM()
        if (!matrix) return
        const point = new DOMPoint(
          event.clientX,
          event.clientY,
        ).matrixTransform(matrix.inverse())
        onCursor({ x: point.x, y: -point.y })
      }}
    >
      <g transform="scale(1 -1)">
        <path
          d={ringPath([board.outline])}
          fill={themed ? "var(--glass)" : "#243648"}
          fillOpacity={themed ? 0.19 : 1}
          stroke={themed ? "var(--outline)" : "#67849d"}
          strokeWidth="0.04"
        />
        {board.components
          .filter((component) => layers.has(component.layer))
          .map((component) => (
            <rect
              key={component.pcb_component_id}
              x={component.center.x - component.width / 2}
              y={component.center.y - component.height / 2}
              width={component.width}
              height={component.height}
              fill="none"
              stroke={themed ? "var(--outline)" : "#7897b5"}
              strokeWidth="0.04"
            />
          ))}
        {ordered.map((feature) => {
          const style = copperStyles[feature.category]
          const active = feature.id === (hovered ?? selected)?.id
          let color = themed ? `var(--${feature.category})` : style.color
          if (active) color = themed ? "var(--highlight)" : "#e9fcff"
          const shapes = feature.shapes.filter((shape) =>
            shape.layers.some((layer) => layers.has(layer)),
          )
          if (shapes.length === 0) return null
          return (
            <g
              key={feature.id}
              data-copper-id={feature.id}
              onContextMenu={(event) => {
                if (!onContext) return
                event.preventDefault()
                onContext({ feature, x: event.clientX, y: event.clientY })
              }}
              opacity={active ? 1 : style.opacity}
              onPointerEnter={() => onHover(feature)}
              onPointerLeave={() => onHover(undefined)}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(feature)
              }}
            >
              {shapes.map((shape, index) => (
                <CopperShape
                  // biome-ignore lint/suspicious/noArrayIndexKey: These stateless primitives are drawn in route order.
                  key={index}
                  shape={shape}
                  color={color}
                />
              ))}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
