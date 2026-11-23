import { type JSX, useEffect, useRef, useState } from "react"
import { type InspectorInput, loadInput } from "../channel-inspector/input"
import { Icon, type Menu, MenuBar, Modal, themeIds, themes } from "./chrome"
import { loadRecent, loadTheme, saveRecent, setTheme } from "./storage"
import { ChildWindow, useWindows, windowTitles } from "./windows"
import "./workbench.css"

/** Desktop entry point for offline Circuit JSON inspection and simulation. */
export function Workbench(): JSX.Element {
  const [theme, selectTheme] = useState(loadTheme)
  const [recent, setRecent] = useState(loadRecent)
  const [input, setInput] = useState<InspectorInput>()
  const [about, setAbout] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const properties = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const windows = useWindows()
  useEffect(() => setTheme(theme), [theme])

  /** Open a board in the active workspace. */
  const load = async (file?: File): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    setStatus("Reading Circuit JSON…")
    try {
      const next = await loadInput(file)
      setInput(next)
      setRecent((previous) => saveRecent({ name: next.name, recent: previous }))
      windows.show("board")
      setStatus("Ready")
    } catch (cause) {
      setError((cause as Error).message)
      setStatus("Open failed")
    } finally {
      setBusy(false)
    }
  }
  /** Prompt for a local Circuit JSON file. */
  const openFile = (): void => fileInput.current?.click()
  /** Render the bundled parallel-bus fixture. */
  const openSample = (): void => {
    void load()
  }
  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Open Circuit JSON…", shortcut: "Ctrl+O", action: openFile },
        { label: "Open Sample", action: openSample },
        ...recent.map((name) => ({
          label: `Recent · ${name}`,
          action: name === "Parallel bus sample" ? openSample : openFile,
          title: "Reopen a recent local design",
        })),
        { label: "Save Design As…" },
      ],
    },
    {
      label: "Edit",
      items: [
        {
          label: "Property Grid",
          action: () => properties.current?.focus(),
        },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Board Viewer",
          action: input && (() => windows.show("board")),
        },
        ...themeIds.map((id) => ({
          label: `Theme ▸ ${themes[id]}`,
          checked: theme === id,
          action: () => selectTheme(id),
        })),
      ],
    },
    {
      label: "Setup",
      items: [{ label: "Stackup Editor" }, { label: "Stimulus / Aggressors…" }],
    },
    {
      label: "Models",
      items: [
        { label: "Assign Models…" },
        { label: "Visual IBIS Editor" },
        { label: "Load External IBIS…", title: "Coming later" },
      ],
    },
    { label: "Simulate", items: [{ label: "Run", shortcut: "F5" }] },
    {
      label: "Tools",
      items: [{ label: "Oscilloscope" }, { label: "Simulation Log" }],
    },
    {
      label: "Window",
      items: [
        ...(["Cascade", "Tile", "Maximize"] as const).map((mode) => ({
          label: mode,
          action: () => windows.arrange(mode),
        })),
        ...windows.frames.map(({ id }) => ({
          label: windowTitles[id],
          action: () => windows.show(id),
        })),
      ],
    },
    {
      label: "Help",
      items: [{ label: "About SI Workbench", action: () => setAbout(true) }],
    },
  ]

  return (
    <main
      className="wb-desktop"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const file = event.dataTransfer.files[0]
        if (file) void load(file)
      }}
    >
      <header className="wb-title">
        <Icon name="app" />
        <h1>tscircuit SI Workbench</h1>
        {input && <span> — {input.name}</span>}
      </header>
      <MenuBar menus={menus} />
      <div className="wb-toolbar" role="toolbar" aria-label="Workbench tools">
        <button
          title="Open Circuit JSON (Ctrl+O)"
          aria-label="Open Circuit JSON"
          onClick={openFile}
        >
          <Icon name="open" />
        </button>
        <button
          title="Open Sample"
          aria-label="Open Sample"
          onClick={openSample}
        >
          <Icon name="sample" />
        </button>
        <span className="wb-separator" />
        <button
          title="Board Viewer"
          aria-label="Board Viewer"
          disabled={!input}
          onClick={() => windows.show("board")}
        >
          <Icon name="board" />
        </button>
      </div>
      <input
        type="file"
        ref={fileInput}
        hidden
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void load(file)
          event.currentTarget.value = ""
        }}
      />
      <div className="wb-docks">
        <aside className="wb-dock">
          <h2>Project Explorer</h2>
          <div className="wb-tree" role="tree" aria-label="Project Explorer">
            {input && (
              <button role="treeitem" onClick={() => windows.show("board")}>
                <Icon name="board" />
                {input.name}
              </button>
            )}
            {!input && <span className="wb-muted">No design open</span>}
          </div>
        </aside>
        <div className="wb-workspace" aria-label="Window workspace">
          {!input && (
            <div className="wb-empty">
              <Icon name="app" />
              <p>Open or drop a Circuit JSON design.</p>
              <button onClick={openSample} disabled={busy}>
                Open Sample
              </button>
            </div>
          )}
          {windows.frames.map((frame, index) => (
            <ChildWindow
              key={frame.id}
              frame={frame}
              active={
                index ===
                windows.frames.findLastIndex((item) => !item.minimized)
              }
              activate={() => windows.show(frame.id)}
              close={() => windows.close(frame.id)}
              change={windows.change}
            >
              {input && (
                <div className="wb-placeholder">
                  {input.board.layers.length} copper layers ·{" "}
                  {input.simulations.length} simulation(s)
                </div>
              )}
            </ChildWindow>
          ))}
        </div>
        <aside
          className="wb-dock"
          data-dock="properties"
          ref={properties}
          tabIndex={-1}
        >
          <h2>Property Grid</h2>
          {input && (
            <table className="wb-grid">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Design</td>
                  <td>{input.name}</td>
                </tr>
                <tr>
                  <td>Width</td>
                  <td>{input.board.width} mm</td>
                </tr>
                <tr>
                  <td>Height</td>
                  <td>{input.board.height} mm</td>
                </tr>
                <tr>
                  <td>Copper layers</td>
                  <td>{input.board.layers.length}</td>
                </tr>
              </tbody>
            </table>
          )}
        </aside>
      </div>
      {error && (
        <div className="wb-error" role="alert">
          {error}
        </div>
      )}
      <footer className="wb-status">
        <span role="status">{status}</span>
        <span>X — mm · Y — mm</span>
        <span>Layer —</span>
        <span>{input?.name ?? "No selection"}</span>
        <progress
          max={1}
          value={busy ? undefined : 0}
          aria-label="Simulation progress"
        />
      </footer>
      {about && (
        <Modal title="About SI Workbench" close={() => setAbout(false)}>
          <h2>tscircuit SI Workbench</h2>
          <p>Local signal integrity analysis for Circuit JSON.</p>
        </Modal>
      )}
    </main>
  )
}
