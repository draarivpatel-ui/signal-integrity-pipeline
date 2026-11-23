import {
  type JSX,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

export const themes = {
  classic: "Windows Classic",
  luna: "XP Luna",
  dark: "Dark",
} as const
export type Theme = keyof typeof themes
export const themeIds = ["classic", "luna", "dark"] as const

export interface Command {
  label: string
  action?: () => void
  shortcut?: string
  title?: string
  checked?: boolean
}

export interface Menu {
  label: string
  items: Command[]
}

/** Match a visible shortcut against the current keypress. */
function matches({
  shortcut,
  event,
}: {
  shortcut: string
  event: KeyboardEvent
}): boolean {
  const key = shortcut.split("+").at(-1)
  return (
    key?.toLowerCase() === event.key.toLowerCase() &&
    shortcut.startsWith("Ctrl+") === (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  )
}

/** A mouse and keyboard operable desktop menu bar. */
export function MenuBar({ menus }: { menus: Menu[] }): JSX.Element {
  const [open, setOpen] = useState<string>()
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    /** Dismiss a dropdown when focus moves to the workspace by pointer. */
    const onPointer = (event: globalThis.PointerEvent): void => {
      if (!bar.current?.contains(event.target as Node)) setOpen(undefined)
    }
    /** Activate a menu by its mnemonic or run a named command. */
    const onKey = (event: KeyboardEvent): void => {
      if (document.querySelector("dialog[open]")) return
      if (event.key === "Escape") {
        setOpen(undefined)
        return
      }
      const menu = menus.find(
        ({ label }) =>
          event.altKey && event.key.toLowerCase() === label[0].toLowerCase(),
      )
      if (menu) {
        event.preventDefault()
        setOpen(menu.label)
        requestAnimationFrame(() =>
          bar.current
            ?.querySelector<HTMLButtonElement>("[role=menuitem]:enabled")
            ?.focus(),
        )
        return
      }
      const command = menus
        .flatMap(({ items }) => items)
        .find(({ shortcut }) => shortcut && matches({ shortcut, event }))
      if (!command?.action) return
      event.preventDefault()
      command.action()
      setOpen(undefined)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [menus])
  return (
    <nav className="wb-menu-bar" ref={bar} aria-label="Main menu">
      {menus.map(({ label, items }) => (
        <div className="wb-menu" key={label}>
          <button
            aria-expanded={open === label}
            aria-haspopup="menu"
            onPointerEnter={() => {
              if (open) setOpen(label)
            }}
            onClick={() => setOpen(open === label ? undefined : label)}
          >
            <u>{label[0]}</u>
            {label.slice(1)}
          </button>
          {open === label && (
            <div
              className="wb-popover"
              role="menu"
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
                event.preventDefault()
                const entries = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:enabled",
                  ),
                ]
                const delta = event.key === "ArrowDown" ? 1 : -1
                entries[
                  (entries.indexOf(
                    document.activeElement as HTMLButtonElement,
                  ) +
                    delta +
                    entries.length) %
                    entries.length
                ]?.focus()
              }}
            >
              {items.map((item) => (
                <CommandButton
                  key={item.label}
                  command={item}
                  onInvoke={() => setOpen(undefined)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}

/** One command in a menu or context menu. */
export function CommandButton({
  command,
  onInvoke,
}: {
  command: Command
  onInvoke: () => void
}): JSX.Element {
  return (
    <button
      role="menuitem"
      disabled={!command.action}
      title={command.title ?? command.label}
      onClick={() => {
        command.action?.()
        onInvoke()
      }}
    >
      <span className="wb-command-check">{command.checked && "✓"}</span>
      <span>{command.label}</span>
      <kbd>{command.shortcut}</kbd>
    </button>
  )
}

const iconPaths = {
  app: "M3 12h3V5h4v6h4V3M2 15h14",
  open: "M2 5h5l2 2h7v8H2zM3 11h12",
  sample: "M2 4h14v11H2zM5 7h3v4h5M12 7h2M5 13h2",
  board: "M2 7l7-4 7 4-7 4zM2 7v4l7 4 7-4V7M9 11v4",
  stackup: "M2 6l7-4 7 4-7 4zM2 9l7 4 7-4M2 12l7 4 7-4",
  models: "M5 5h8v8H5zM7 2v3m4-3v3M7 13v3m4-3v3M2 7h3m-3 4h3m8-4h3m-3 4h3",
  stimulus: "M2 12h3V5h4v7h4V5h3",
  run: "M5 3l10 6-10 6z",
  scope: "M2 3h14v12H2zM4 11l2-3 2 3 2-5 3 3h1",
  log: "M4 2h7l3 3v11H4zM6 7h6m-6 3h6m-6 3h4",
  save: "M3 2h10l2 2v12H3zM6 2v5h6V2M6 16v-5h6v5",
} as const
export type IconName = keyof typeof iconPaths

/** Draw an original 16-pixel toolbar glyph. */
export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d={iconPaths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Open a native modal with themed desktop chrome and standard dialog actions. */
export function Modal({
  title,
  close,
  apply,
  children,
}: {
  title: string
  close: () => void
  apply?: () => boolean
  children: ReactNode
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      className="wb-modal"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="wb-child-title">
        <strong id={titleId}>{title}</strong>
        <button aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </div>
      <div className="wb-dialog-body">{children}</div>
      <div className="wb-dialog-actions">
        <button
          onClick={() => {
            if (!apply || apply()) close()
          }}
        >
          OK
        </button>
        {apply && <button onClick={close}>Cancel</button>}
        {apply && <button onClick={apply}>Apply</button>}
      </div>
    </dialog>
  )
}
