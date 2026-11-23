import { type JSX, type ReactNode, useRef, useState } from "react"
import type { InspectorFeature } from "../channel-inspector/geometry"
import type { ProjectNode, PropertyGroup } from "./project"

/** A dock and its horizontal sizing handle. */
export function Dock({
  side,
  title,
  shown,
  close,
  children,
}: {
  side: "left" | "right"
  title: string
  shown: boolean
  close: () => void
  children: ReactNode
}): JSX.Element | null {
  const [width, setWidth] = useState(side === "left" ? 230 : 250)
  const drag = useRef<{ origin: number; width: number }>(undefined)
  if (!shown) return null
  return (
    <div className="wb-dock-wrap" data-side={side} style={{ width }}>
      <aside className="wb-dock">
        <h2>
          {title}
          <button
            title={`Close ${title}`}
            aria-label={`Close ${title}`}
            onClick={close}
          >
            ×
          </button>
        </h2>
        {children}
      </aside>
      <div
        className="wb-splitter"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            origin: event.clientX,
            width: event.currentTarget.parentElement!.clientWidth,
          }
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1 || !drag.current) return
          const delta = event.clientX - drag.current.origin
          setWidth(
            Math.min(
              420,
              Math.max(
                145,
                drag.current.width + delta * (side === "left" ? 1 : -1),
              ),
            ),
          )
        }}
        onPointerUp={() => {
          drag.current = undefined
        }}
        onPointerCancel={() => {
          drag.current = undefined
        }}
      />
    </div>
  )
}

/** Display stable property categories for a hovered or selected object. */
export function Properties({
  node,
  feature,
}: {
  node?: ProjectNode
  feature?: InspectorFeature
}): JSX.Element | null {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [property, setProperty] = useState<string>()
  if (!node && !feature) return null
  const geometry: PropertyGroup[] = []
  if (feature) {
    const widths = [
      ...new Set(
        feature.shapes.flatMap((shape) => {
          if (shape.shape === "wire") return [shape.width]
          if (shape.shape === "via") return [shape.diameter]
          return []
        }),
      ),
    ]
    const length = feature.shapes.reduce((total, shape) => {
      if (shape.shape !== "wire") return total
      return (
        total +
        Math.hypot(shape.start.x - shape.end.x, shape.start.y - shape.end.y)
      )
    }, 0)
    geometry.push(
      {
        name: "Copper identity",
        fields: [
          ["ID", feature.id],
          ["Type", feature.record.type],
          ["Category", feature.category],
          ["Scope", feature.reason],
        ],
      },
      {
        name: "Route geometry",
        fields: [
          ["Layers", feature.layers.join(", ")],
          ["Width / diameter", widths.length ? `${widths.join(", ")} mm` : "—"],
          ["Length", length ? `${length.toFixed(2)} mm` : "—"],
        ],
      },
    )
  }
  const groups = [...(node?.groups ?? []), ...geometry]
  return (
    <div className="wb-properties">
      <strong className="wb-property-caption">
        {node?.label ?? feature?.id}
      </strong>
      <div className="wb-property-scroll">
        <table className="wb-grid">
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          {groups.map(({ name, fields }) => (
            <tbody key={name}>
              <tr className="wb-property-group">
                <th colSpan={2}>
                  <button
                    aria-expanded={!collapsed.includes(name)}
                    onClick={() =>
                      setCollapsed((items) =>
                        items.includes(name)
                          ? items.filter((item) => item !== name)
                          : [...items, name],
                      )
                    }
                  >
                    {collapsed.includes(name) ? "+" : "−"} · {name}
                  </button>
                </th>
              </tr>
              {!collapsed.includes(name) &&
                fields.map(([label, value]) => (
                  <tr
                    key={label}
                    aria-selected={property === label}
                    onClick={() => setProperty(label)}
                  >
                    <td>{label}</td>
                    <td>{value}</td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="wb-property-help">
        <strong>{property ?? "Description"}</strong>
        <br />
        {feature?.reason ??
          node?.description ??
          "Select another project item to inspect its properties."}
      </div>
    </div>
  )
}
