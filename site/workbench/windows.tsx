import type { CSSProperties, JSX, PointerEvent, ReactNode } from "react"
import { useRef, useState } from "react"

import { Icon } from "./chrome"

export const windowTitles = {
  board: "Board Viewer",
  stackup: "Stackup Editor",
  ibis: "Visual IBIS Editor",
  log: "Simulation Log",
  scope: "Oscilloscope",
} as const
export type WindowId = keyof typeof windowTitles

/** Position and activation state of one child window. */
export interface Frame {
  id: WindowId
  z: number
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  maximized: boolean
}

export type Arrange = "Cascade" | "Tile" | "Maximize"

/** Put a newly opened tool slightly below and right of the previous one. */
function newFrame({ id, count }: { id: WindowId; count: number }): Frame {
  const offset = 2 + count * 3
  return {
    id,
    z: 0,
    x: offset,
    y: offset,
    width: 95 - offset,
    height: 94 - offset,
    minimized: false,
    maximized: false,
  }
}

/** Keep activation order and percentage bounds independent of the tool contents. */
export function useWindows(): {
  frames: Frame[]
  show: (id: WindowId) => void
  close: (id: WindowId) => void
  change: (frame: Frame) => void
  arrange: (mode: Arrange) => void
} {
  const [frames, setFrames] = useState<Frame[]>([])
  return {
    frames,
    show: (id) =>
      setFrames((items) => {
        const existing = items.find((frame) => frame.id === id)
        const next = existing ?? newFrame({ id, count: items.length })
        const activated = {
          ...next,
          minimized: false,
          z: Math.max(0, ...items.map(({ z }) => z)) + 1,
        }
        if (!existing) return [...items, activated]
        return items.map((frame) => (frame.id === id ? activated : frame))
      }),
    close: (id) =>
      setFrames((items) => items.filter((frame) => frame.id !== id)),
    change: (next) =>
      setFrames((items) =>
        items.map((frame) =>
          next.id === frame.id ? { ...next, z: frame.z } : frame,
        ),
      ),
    arrange: (mode) =>
      setFrames((items) => {
        const visible = items.filter((frame) => !frame.minimized)
        return items.map((frame) => {
          const index = visible.indexOf(frame)
          if (index < 0) return frame
          if (mode === "Cascade")
            return { ...newFrame({ id: frame.id, count: index }), z: frame.z }
          if (mode === "Maximize")
            return { ...frame, maximized: index === visible.length - 1 }
          const columns = Math.ceil(Math.sqrt(visible.length))
          const rows = Math.ceil(visible.length / columns)
          return {
            ...frame,
            maximized: false,
            x: ((index % columns) * 100) / columns,
            y: (Math.floor(index / columns) * 100) / rows,
            width: 100 / columns,
            height: 100 / rows,
          }
        })
      }),
  }
}

interface Gesture {
  frame: Frame
  clientX: number
  clientY: number
  resize: boolean
  width: number
  height: number
}

/** Capture a title bar or resize grip until the current pointer gesture ends. */
function startGesture({
  event,
  frame,
  resize,
}: {
  event: PointerEvent<HTMLElement>
  frame: Frame
  resize: boolean
}): Gesture | undefined {
  const workspace = event.currentTarget.closest(".wb-workspace")
  if (
    !workspace ||
    frame.maximized ||
    frame.minimized ||
    event.button !== 0 ||
    (event.target as HTMLElement).closest("button")
  )
    return
  event.currentTarget.setPointerCapture(event.pointerId)
  return {
    frame,
    clientX: event.clientX,
    clientY: event.clientY,
    resize,
    width: workspace.clientWidth,
    height: workspace.clientHeight,
  }
}

/** Convert a pointer gesture into clamped workspace percentages. */
function moveFrame({
  event,
  gesture,
}: {
  event: PointerEvent<HTMLElement>
  gesture: Gesture
}): Frame {
  const { frame, clientX, clientY, width, height, resize } = gesture
  const x = ((event.clientX - clientX) * 100) / width
  const y = ((event.clientY - clientY) * 100) / height
  if (resize)
    return {
      ...frame,
      width: Math.min(100 - frame.x, Math.max(28, frame.width + x)),
      height: Math.min(100 - frame.y, Math.max(24, frame.height + y)),
    }
  return {
    ...frame,
    x: Math.max(0, Math.min(90, frame.x + x)),
    y: Math.max(0, Math.min(90, frame.y + y)),
  }
}

/** Render a movable, resizable, minimizable MDI child. */
export function ChildWindow({
  frame,
  active,
  activate,
  close,
  change,
  children,
}: {
  frame: Frame
  active: boolean
  activate: () => void
  close: () => void
  change: (frame: Frame) => void
  children: ReactNode
}): JSX.Element {
  const gesture = useRef<Gesture>(undefined)
  const bounds: CSSProperties = frame.maximized
    ? { inset: 0 }
    : {
        left: `${frame.x}%`,
        top: `${frame.y}%`,
        width: `${frame.width}%`,
        height: `${frame.height}%`,
      }
  return (
    <section
      className="wb-child"
      data-window={frame.id}
      data-active={active}
      style={{ ...bounds, zIndex: frame.z }}
      hidden={frame.minimized}
      onPointerDown={() => {
        if (!active) activate()
      }}
    >
      <header
        className="wb-child-title"
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button"))
            change({ ...frame, maximized: !frame.maximized })
        }}
        onPointerDown={(event) => {
          gesture.current = startGesture({ event, frame, resize: false })
        }}
        onPointerUp={() => {
          gesture.current = undefined
        }}
        onPointerCancel={() => {
          gesture.current = undefined
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1 && gesture.current)
            change(moveFrame({ event, gesture: gesture.current }))
        }}
      >
        <span className="wb-caption">
          <Icon name={frame.id === "ibis" ? "models" : frame.id} />
          {windowTitles[frame.id]}
        </span>
        <div>
          <button
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => change({ ...frame, minimized: true })}
          >
            _
          </button>
          <button
            aria-label="Toggle maximize window"
            title="Maximize or restore"
            onClick={() => change({ ...frame, maximized: !frame.maximized })}
          >
            □
          </button>
          <button aria-label="Close window" title="Close" onClick={close}>
            ×
          </button>
        </div>
      </header>
      <div className="wb-child-body">{children}</div>
      {!frame.maximized && (
        <span
          className="wb-grip"
          aria-hidden="true"
          onPointerDown={(event) => {
            gesture.current = startGesture({ event, frame, resize: true })
          }}
          onPointerUp={() => {
            gesture.current = undefined
          }}
          onPointerCancel={() => {
            gesture.current = undefined
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1 && gesture.current)
              change(moveFrame({ event, gesture: gesture.current }))
          }}
        />
      )}
    </section>
  )
}
