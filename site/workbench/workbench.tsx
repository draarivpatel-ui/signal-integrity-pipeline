import {
  type JSX,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { loadInput } from "../channel-inspector/input"
import type { IbisFocus } from "./assign-models"
import { useBoardSelection } from "./board-selection"
import { BoardViewer } from "./board-viewer"
import { Icon, MenuBar } from "./chrome"
import { CopperMenu, useCopperContextDismiss } from "./copper-menu"
import { useDesignHistory } from "./design-history"
import { DesktopStatus, DesktopTitle } from "./desktop-frame"
import { Dock, Properties } from "./docks"
import { exportDesign, exportWaveforms, exportWindow } from "./exports"
import { IbisViewer } from "./ibis-viewer"
import { type CommandActions, workbenchMenus } from "./menus"
import { editNetRole, type NetRole } from "./model/net-roles"
import { Oscilloscope, type ScopeTab } from "./oscilloscope"
import {
  findProjectNode,
  type ProjectNode,
  ProjectTree,
  projectNodes,
} from "./project"
import { captureNodes, diagnosticNode } from "./run-project"
import { SimulationLog } from "./simulation-log"
import { useSimulation } from "./simulation-state"
import { StackupEditor } from "./stackup-editor"
import { loadRecent, loadTheme, saveRecent, setTheme } from "./storage"
import { Toolbar } from "./toolbar"
import { ChildWindow, MinimizedWindows, useWindows } from "./windows"
import { type ActiveDialog, WorkbenchDialogs } from "./workbench-dialogs"
import "./workbench.css"

/** Desktop entry point for offline Circuit JSON inspection and simulation. */
export function Workbench(): JSX.Element {
  const [theme, selectTheme] = useState(loadTheme)
  const [recent, setRecent] = useState(loadRecent)
  const design = useDesignHistory()
  const runner = useSimulation()
  const [selectedRun, setSelectedRun] = useState<number>()
  const [scopeTab, setScopeTab] = useState<ScopeTab>("Waveforms")
  const [compare, setCompare] = useState(false)
  const [dialog, setDialog] = useState<ActiveDialog>()
  const { input } = design
  const [simulationIndex, setSimulationIndex] = useState(0)
  const [treeId, setTreeId] = useState<string>()
  const [showTree, setShowTree] = useState(true)
  const [showProperties, setShowProperties] = useState(true)
  const simulation = input?.simulations[simulationIndex]
  const [ibisFocus, setIbisFocus] = useState<IbisFocus>()
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
      projectNodes({
        input,
        active: simulation,
        features: selection.features,
        results: captureNodes(runner.runs),
      }),
    [input, simulation, selection.features, runner.runs],
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
  /** Open the selected project editor or result. */
  const openNode = (node: ProjectNode): void => {
    if (node.window === "scope") {
      setSelectedRun(node.run)
      setScopeTab("Waveforms")
      windows.show("scope")
      return
    }
    if (node.window === "board" || node.window === "stackup")
      windows.show(node.window)
    else if (node.modelId)
      setDialog({ kind: "assign", port: node.port, modelId: node.modelId })
  }
  useCopperContextDismiss(selection)

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
    if (busy || runner.solver === "running") return
    setBusy(true)
    setError(undefined)
    setStatus("Reading Circuit JSON…")
    try {
      const next = await loadInput(file)
      selection.reset()
      runner.reset()
      setSelectedRun(undefined)
      setCompare(false)
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
  /** Open the stage log and execute the active transient. */
  const run = (): void => {
    if (!input || !simulation || busy || runner.solver === "running") return
    windows.show("log")
    void runner.start({
      input,
      simulation,
      onCapture: () => {
        setSelectedRun(undefined)
        setScopeTab("Waveforms")
        windows.show("scope")
      },
    })
  }
  const lastRun = runner.runs.at(-1)
  const activeRun = runner.runs.find(({ id }) => id === selectedRun) ?? lastRun
  const canCompare =
    activeRun &&
    runner.runs.some(
      (item) =>
        item.id < activeRun.id && item.simulationId === activeRun.simulationId,
    )
  /** Close this local design and its run history. */
  const closeBoard = (): void => {
    design.open()
    selection.reset()
    runner.reset()
    windows.reset()
    setTreeId(undefined)
    setSelectedRun(undefined)
    setCompare(false)
    setError(undefined)
    setStatus("Ready")
    setDialog(undefined)
  }
  const activeFrame = windows.frames.find(
    ({ z, minimized }) => z === activeZ && !minimized,
  )
  /** Prompt for a local file. */
  const openFile = (): void => fileInput.current?.click()
  /** Render the bundled TSX board. */
  const openSample = (): void => {
    void load()
  }
  const actions: CommandActions = {
    open: runner.solver !== "running" ? openFile : undefined,
    save: input && (() => exportDesign(input)),
    csv: activeRun && (() => exportWaveforms(activeRun)),
    png:
      activeFrame &&
      (() =>
        void exportWindow(activeFrame.id).catch((cause: Error) =>
          setError(cause.message),
        )),
    close:
      input && runner.solver !== "running"
        ? () => {
            if (design.dirty) setDialog({ kind: "discard" })
            else closeBoard()
          }
        : undefined,
    sample: runner.solver !== "running" ? openSample : undefined,
    undo: design.undo,
    redo: design.redo,
    reset: design.reset,
    board: input && (() => windows.show("board")),
    stackup: input && (() => windows.show("stackup")),
    run: simulation && !busy && runner.solver !== "running" ? run : undefined,
    stop: runner.stop,
    scope: () => {
      setScopeTab("Waveforms")
      windows.show("scope")
    },
    eye: () => {
      setScopeTab("Eye Diagram")
      windows.show("scope")
    },
    compare: canCompare
      ? () => {
          setCompare(!compare)
          windows.show("scope")
        }
      : undefined,
    log: () => windows.show("log"),
    solver: () => {
      windows.show("log")
      void runner.check(true)
    },
    deck: lastRun && (() => setDialog({ kind: "deck" })),
    stimulus: simulation && (() => setDialog({ kind: "stimulus" })),

    assign:
      input &&
      (() =>
        setDialog({
          kind: "assign",
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
    about: () => setDialog({ kind: "about" }),
  }
  const menus = workbenchMenus({
    actions,
    comparing: compare && canCompare,
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
      <DesktopTitle
        board={input?.name}
        simulation={simulation?.name}
        dirty={design.dirty}
        close={actions.close}
        toggleDocks={() => {
          const next = !showTree && !showProperties
          setShowTree(next)
          setShowProperties(next)
        }}
        toggleFullscreen={() => {
          const pending = document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen()
          void pending.catch((cause: Error) => setError(cause.message))
        }}
      />
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
              {frame.id === "log" && (
                <SimulationLog
                  entries={runner.entries}
                  clear={runner.clearLog}
                  targets={(entry) => diagnosticNode({ root, entry })}
                  showDeck={actions.deck}
                  showOnBoard={(id) => {
                    const node = findProjectNode({ root, id })
                    if (node) pickNode(node)
                    windows.show("board")
                  }}
                />
              )}
              {frame.id === "scope" && (
                <Oscilloscope
                  runs={runner.runs}
                  run={activeRun}
                  selectRun={setSelectedRun}
                  tab={scopeTab}
                  selectTab={setScopeTab}
                  compare={compare}
                  toggleCompare={() => setCompare(!compare)}
                  exportCsv={actions.csv}
                  exportPng={() =>
                    void exportWindow("scope").catch((cause: Error) =>
                      setError(cause.message),
                    )
                  }
                />
              )}
            </ChildWindow>
          ))}
          <MinimizedWindows
            frames={windows.frames}
            restore={windows.show}
            close={windows.close}
          />
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
      <DesktopStatus
        runner={runner}
        status={status}
        cursor={selection.cursor}
        picked={selection.selected}
        hovered={selection.hovered}
      />
      {selection.context && (
        <CopperMenu
          context={selection.context}
          editable={
            selection.selected?.record.type === "pcb_trace" &&
            selection.selected.category !== "rail"
          }
          edit={changeRole}
          close={selection.closeContext}
        />
      )}
      <WorkbenchDialogs
        dialog={dialog}
        input={input}
        simulation={simulation}
        retained={selection.retained}
        apply={design.edit}
        close={() => setDialog(undefined)}
        closeBoard={closeBoard}
        lastRun={lastRun}
        version={runner.version}
        showCurves={(focus) => {
          setIbisFocus(focus)
          setDialog(undefined)
          windows.show("ibis")
        }}
      />
    </main>
  )
}
