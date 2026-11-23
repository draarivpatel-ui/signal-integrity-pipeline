import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { loadInput } from "../channel-inspector/input"
import { useBoardSelection } from "./board-selection"
import { BoardViewer, boardCoordinates } from "./board-viewer"
import {
  CommandButton,
  Icon,
  type Menu,
  MenuBar,
  Modal,
  themeIds,
  themes,
} from "./chrome"
import { useDesignHistory } from "./design-history"
import { Dock, Properties } from "./docks"
import { editNetRole, type NetRole } from "./model/net-roles"
import {
  findProjectNode,
  type ProjectNode,
  ProjectTree,
  projectNodes,
} from "./project"
import { loadRecent, loadTheme, saveRecent, setTheme } from "./storage"
import { ChildWindow, useWindows, windowTitles } from "./windows"
import "./workbench.css"

/** Desktop entry point for offline Circuit JSON inspection and simulation. */
export function Workbench(): JSX.Element {
  const [theme, selectTheme] = useState(loadTheme)
  const [recent, setRecent] = useState(loadRecent)
  const design = useDesignHistory()
  const { input } = design
  const [simulationIndex, setSimulationIndex] = useState(0)
  const [treeId, setTreeId] = useState<string>()
  const [showTree, setShowTree] = useState(true)
  const [showProperties, setShowProperties] = useState(true)
  const simulation = input?.simulations[simulationIndex]
  const [about, setAbout] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const windows = useWindows()
  useLayoutEffect(() => setTheme(theme), [theme])
  const selection = useBoardSelection({
    input,
    simulation,
    onPick: useCallback(() => setTreeId(undefined), []),
  })
  const activeZ = Math.max(
    0,
    ...windows.frames.filter((frame) => !frame.minimized).map(({ z }) => z),
  )
  const root = useMemo(
    () =>
      input &&
      projectNodes({ input, active: simulation, features: selection.features }),
    [input, simulation, selection.features],
  )
  const chosenNode = findProjectNode({
    root,
    id: treeId,
    copper: treeId ? undefined : selection.selected?.id,
  })
  const boardFocus = selection.selected ?? selection.hovered
  /** Synchronize a tree click with the selected physical board object. */
  const pickNode = (node: ProjectNode): void => {
    if (node.simulation !== undefined && node.simulation !== simulationIndex)
      setSimulationIndex(node.simulation)
    setTreeId(node.id)
    selection.select(node.copper?.id)
  }
  /** Focus the window associated with a project branch. */
  const openNode = (node: ProjectNode): void => {
    if (node.window === "board") windows.show(node.window)
  }
  useEffect(() => {
    if (!selection.context) return
    const end = new AbortController()
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!(event.target as HTMLElement).closest(".wb-context"))
          selection.closeContext()
      },
      { signal: end.signal },
    )
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") selection.closeContext()
      },
      { signal: end.signal },
    )
    return () => end.abort()
  }, [selection.context])

  /** Apply a role to source copper through a new channel design. */
  const changeRole = (role: NetRole): void => {
    const trace = selection.selected?.record
    if (
      !input ||
      !simulation ||
      trace?.type !== "pcb_trace" ||
      selection.selected?.category === "rail"
    )
      return
    try {
      const circuit = editNetRole({
        circuit: input.circuit,
        simulation,
        trace,
        role,
      })
      design.edit(circuit)
      setError(undefined)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  /** Open a board in the active workspace. */
  const load = async (file?: File): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    setStatus("Reading Circuit JSON…")
    try {
      const next = await loadInput(file)
      selection.reset()
      setSimulationIndex(0)
      setTreeId("board")
      design.open(next)
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
        { label: "Open Sample", action: openSample, shortcut: "Ctrl+Shift+O" },
        {
          label: "Open Recent",
          items: recent.length
            ? recent.map((name) => ({
                label: name,
                action: name === "Parallel bus sample" ? openSample : openFile,
              }))
            : [{ label: "(No recent files)" }],
        },
        { label: "file separator", separator: true },
        { label: "Save Design As…" },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo Design Edit", shortcut: "Ctrl+Z", action: design.undo },
        { label: "Redo Design Edit", shortcut: "Ctrl+Y", action: design.redo },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Board Viewer",
          action: input && (() => windows.show("board")),
        },
        {
          label: "Project Explorer",
          shortcut: "Ctrl+Alt+P",
          checked: showTree,
          action: () => setShowTree(!showTree),
        },
        {
          label: "Properties Inspector",
          shortcut: "Ctrl+Alt+R",
          checked: showProperties,
          action: () => setShowProperties(!showProperties),
        },
        { label: "theme separator", separator: true },
        {
          label: "Theme",
          items: themeIds.map((id) => ({
            label: themes[id],
            checked: theme === id,
            action: () => selectTheme(id),
          })),
        },
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
    {
      label: "Simulate",
      mnemonic: 1,
      items: [{ label: "Run", shortcut: "F5" }],
    },
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
        <h1>
          tscircuit SI Workbench - [
          {input
            ? `${input.name} | ${simulation?.name ?? "Simulation"}`
            : "No Board Loaded"}
          ]{design.dirty && "*"}
        </h1>
      </header>
      <MenuBar menus={menus} />
      <div className="wb-toolbar" role="toolbar" aria-label="Workbench tools">
        <i className="wb-rebar" aria-hidden="true" />
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
        {input && (
          <label>
            Sim:{" "}
            <select
              aria-label="Active simulation"
              value={simulationIndex}
              onChange={(event) => {
                selection.select(undefined)
                setTreeId(undefined)
                setSimulationIndex(Number(event.target.value))
              }}
            >
              {input.simulations.map((item, index) => (
                <option
                  key={item.simulation_pcb_transient_channel_simulation_id}
                  value={index}
                >
                  {item.name ??
                    item.simulation_pcb_transient_channel_simulation_id}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="wb-theme-switch">
          Theme:{" "}
          <select
            aria-label="Theme"
            value={theme}
            onChange={(event) => {
              const id = themeIds.find((value) => value === event.target.value)
              if (id) selectTheme(id)
            }}
          >
            {themeIds.map((id) => (
              <option key={id} value={id}>
                {themes[id]}
              </option>
            ))}
          </select>
        </label>
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
        <Dock
          side="left"
          title="Project Explorer"
          shown={showTree}
          close={() => setShowTree(false)}
        >
          <ProjectTree
            root={root}
            selected={chosenNode?.id}
            pick={pickNode}
            open={openNode}
            context={({ node, event }) => {
              if (!node.copper) return
              event.preventDefault()
              selection.interaction.onContext?.({
                feature: node.copper,
                x: event.clientX,
                y: event.clientY,
              })
            }}
          />
        </Dock>
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
          {windows.frames.map((frame) => (
            <ChildWindow
              key={frame.id}
              frame={frame}
              active={frame.z === activeZ}
              activate={() => windows.show(frame.id)}
              close={() => windows.close(frame.id)}
              change={windows.change}
            >
              {input && (
                <BoardViewer
                  board={input.board}
                  features={selection.features}
                  theme={theme}
                  interaction={selection.interaction}
                  error={selection.error}
                />
              )}
            </ChildWindow>
          ))}
          <div className="wb-minimized-strip">
            {windows.frames
              .filter((frame) => frame.minimized)
              .map((frame) => (
                <div key={frame.id} className="wb-child-title">
                  <span>{windowTitles[frame.id]}</span>
                  <div>
                    <button
                      title="Restore"
                      aria-label={`Restore ${windowTitles[frame.id]}`}
                      onClick={() => windows.show(frame.id)}
                    >
                      ❐
                    </button>
                    <button
                      title="Close"
                      aria-label={`Close ${windowTitles[frame.id]}`}
                      onClick={() => windows.close(frame.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
        <Dock
          side="right"
          title="Properties Inspector"
          shown={showProperties}
          close={() => setShowProperties(false)}
        >
          <Properties
            key={chosenNode?.id ?? boardFocus?.id}
            node={chosenNode ?? (boardFocus ? undefined : root)}
            feature={boardFocus}
          />
        </Dock>
      </div>
      {error && (
        <div className="wb-error" role="alert">
          {error}
        </div>
      )}
      <footer className="wb-status">
        <span role="status">{status}</span>
        <span>{boardCoordinates(selection.cursor)}</span>
        <span>
          Layer{" "}
          {(selection.hovered ?? selection.selected)?.layers.join(", ") || "—"}
        </span>
        <span>{selection.selected?.id ?? "No selection"}</span>
        <progress
          max={1}
          value={busy ? undefined : 0}
          aria-label="Simulation progress"
        />
      </footer>
      {selection.context && (
        <div
          role="menu"
          className="wb-popover wb-context"
          style={{
            left: Math.min(selection.context.x, window.innerWidth - 195),
            top: Math.min(selection.context.y, window.innerHeight - 88),
          }}
        >
          {(["selected", "near", "excluded"] as const).map((role, index) => (
            <CommandButton
              key={role}
              command={{
                label: ["Make victim", "Make aggressor", "Exclude"][index],
                action:
                  selection.selected?.record.type === "pcb_trace" &&
                  selection.selected.category !== "rail"
                    ? () => changeRole(role)
                    : undefined,
              }}
              onInvoke={selection.closeContext}
            />
          ))}
        </div>
      )}
      {about && (
        <Modal title="About SI Workbench" close={() => setAbout(false)}>
          <h2>tscircuit SI Workbench</h2>
          <p>Local signal integrity analysis for Circuit JSON.</p>
        </Modal>
      )}
    </main>
  )
}
