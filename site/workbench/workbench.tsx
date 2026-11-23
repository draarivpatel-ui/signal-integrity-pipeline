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
import { AssignModels, type IbisFocus } from "./assign-models"
import { useBoardSelection } from "./board-selection"
import { BoardViewer, boardCoordinates } from "./board-viewer"
import { CommandButton, Icon, MenuBar, Modal } from "./chrome"
import { useDesignHistory } from "./design-history"
import { Dock, Properties } from "./docks"
import { IbisViewer } from "./ibis-viewer"
import { type CommandActions, workbenchMenus } from "./menus"
import { editNetRole, type NetRole } from "./model/net-roles"
import {
  findProjectNode,
  type ProjectNode,
  ProjectTree,
  projectNodes,
} from "./project"
import { StackupEditor } from "./stackup-editor"
import { StimulusDialog } from "./stimulus-dialog"
import { loadRecent, loadTheme, saveRecent, setTheme } from "./storage"
import { Toolbar } from "./toolbar"
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
  const [assignment, setAssignment] = useState<{
    port?: string
    modelId?: string
  }>()
  const [ibisFocus, setIbisFocus] = useState<IbisFocus>()
  const [stimulusOpen, setStimulusOpen] = useState(false)
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
    if (node.window === "board" || node.window === "stackup")
      windows.show(node.window)
    else if (node.modelId)
      setAssignment({ port: node.port, modelId: node.modelId })
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
  const actions: CommandActions = {
    open: openFile,
    sample: openSample,
    undo: design.undo,
    redo: design.redo,
    reset: design.reset,
    board: input && (() => windows.show("board")),
    stackup: input && (() => windows.show("stackup")),
    stimulus: simulation && (() => setStimulusOpen(true)),

    assign:
      input &&
      (() =>
        setAssignment({
          port: chosenNode?.port,
          modelId: chosenNode?.modelId,
        })),
    ibis: input && (() => windows.show("ibis")),
    victim:
      selection.selected?.record.type === "pcb_trace"
        ? () => changeRole("selected")
        : undefined,
    aggressor:
      selection.selected?.record.type === "pcb_trace"
        ? () => changeRole("near")
        : undefined,
    exclude:
      selection.selected?.record.type === "pcb_trace"
        ? () => changeRole("excluded")
        : undefined,
    clear: () => {
      selection.select(undefined)
      setTreeId(undefined)
    },
    about: () => setAbout(true),
  }
  const menus = workbenchMenus({
    actions,
    recent,
    theme,
    selectTheme,
    showTree,
    toggleTree: () => setShowTree(!showTree),
    showProperties,
    toggleProperties: () => setShowProperties(!showProperties),
    frames: windows.frames,
    showWindow: windows.show,
    arrange: windows.arrange,
  })

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
      <Toolbar
        actions={actions}
        simulations={input?.simulations}
        index={simulationIndex}
        selectSimulation={(index) => {
          selection.select(undefined)
          setTreeId(undefined)
          setSimulationIndex(index)
        }}
        theme={theme}
        selectTheme={selectTheme}
      />
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
              {input && frame.id === "board" && (
                <BoardViewer
                  board={input.board}
                  features={selection.features}
                  theme={theme}
                  interaction={selection.interaction}
                  error={selection.error}
                />
              )}
              {input && frame.id === "stackup" && (
                <StackupEditor
                  circuit={input.circuit}
                  feature={selection.selected}
                  apply={design.edit}
                  close={() => windows.close("stackup")}
                />
              )}
              {input && frame.id === "ibis" && (
                <IbisViewer
                  key={`${ibisFocus?.modelId ?? ""}:${ibisFocus?.buffer ?? ""}`}
                  circuit={input.circuit}
                  initial={ibisFocus}
                  apply={design.edit}
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
      {input && assignment && (
        <AssignModels
          circuit={input.circuit}
          port={assignment.port}
          componentId={assignment.modelId}
          retained={selection.retained}
          apply={design.edit}
          close={() => setAssignment(undefined)}
          showCurves={(focus) => {
            setIbisFocus(focus)
            setAssignment(undefined)
            windows.show("ibis")
          }}
        />
      )}
      {input && simulation && stimulusOpen && (
        <StimulusDialog
          circuit={input.circuit}
          simulation={simulation}
          retained={selection.retained}
          radiusMm={input.distanceMm}
          apply={design.edit}
          close={() => setStimulusOpen(false)}
        />
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
