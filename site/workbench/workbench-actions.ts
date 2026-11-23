import { type Dispatch, type SetStateAction, useState } from "react"
import type { CircuitJson } from "../../src/board"
import {
  type ChannelSimulation,
  type InspectorInput,
  loadInput,
} from "../channel-inspector/input"
import type { BoardSelection } from "./board-selection"
import type { BoardView } from "./board-viewer"
import type { DesignHistory } from "./design-history"
import { exportDesign, exportWaveforms, exportWindow } from "./exports"
import type { SimulationRun } from "./local-run"
import type { CommandActions } from "./menus"
import { editNetRole, type NetRole } from "./model/net-roles"
import type { ScopeTab } from "./oscilloscope"
import type { ProjectNode } from "./project"
import type { SimulationState } from "./simulation-state"
import { loadRecent, saveRecent } from "./storage"
import type { Frame, Windows } from "./windows"
import type { ActiveDialog } from "./workbench-dialogs"

/** The open board session and its file and edit commands. */
interface BoardSession {
  busy: boolean
  status: string
  recent: string[]
  setRecent: Dispatch<SetStateAction<string[]>>
  load: (file?: File) => Promise<void>
  closeBoard: () => void
  changeRole: (role: NetRole) => void
  apply: (circuit: CircuitJson) => void
}

/** Manage local loading and immutable edits for the active board. */
export function useBoardSession({
  design,
  runner,
  selection,
  simulation,
  windows,
  setError,
  onOpen,
}: {
  design: DesignHistory
  runner: SimulationState
  selection: BoardSelection
  simulation?: ChannelSimulation
  windows: Windows
  setError: (message?: string) => void
  onOpen: (input?: InspectorInput) => void
}): BoardSession {
  const [recent, setRecent] = useState(loadRecent)
  const [status, setStatus] = useState("Ready")
  const [busy, setBusy] = useState(false)
  return {
    recent,
    setRecent,
    status,
    busy,
    load: async (file) => {
      if (busy || runner.solver === "running") return
      setBusy(true)
      setError(undefined)
      setStatus("Reading Circuit JSON…")
      try {
        const next = await loadInput(file)
        selection.reset()
        runner.reset()
        windows.reset()
        windows.show("board")
        design.open(next)
        setRecent((previous) =>
          saveRecent({ name: next.name, recent: previous }),
        )
        onOpen(next)
        setStatus("Ready")
      } catch (cause) {
        setError((cause as Error).message)
        setStatus("Open failed")
      } finally {
        setBusy(false)
      }
    },
    closeBoard: () => {
      design.open()
      selection.reset()
      runner.reset()
      windows.reset()
      onOpen()
      setError(undefined)
      setStatus("Ready")
    },
    apply: (circuit) => {
      design.edit(circuit)
      setError(undefined)
    },
    changeRole: (role) => {
      const { input } = design
      const trace = selection.selected?.record
      if (
        !input ||
        !simulation ||
        trace?.type !== "pcb_trace" ||
        selection.selected?.category === "rail"
      )
        return
      try {
        design.edit(
          editNetRole({ circuit: input.circuit, simulation, trace, role }),
        )
        setError(undefined)
      } catch (cause) {
        setError((cause as Error).message)
      }
    },
  }
}

/** Bind menu and toolbar commands to the active session. */
export function workbenchActions({
  session,
  design,
  runner,
  windows,
  simulation,
  boardView,
  activeFrame,
  chosenNode,
  lastRun,
  activeRun,
  canCompare,
  canEditRole,
  openFile,
  openSample,
  setError,
  setDialog,
  setScopeTab,
  toggleCompare,
  clear,
  onCapture,
}: {
  session: BoardSession
  design: DesignHistory
  runner: SimulationState
  windows: Windows
  simulation?: ChannelSimulation
  boardView: BoardView
  activeFrame?: Frame
  chosenNode?: ProjectNode
  lastRun?: SimulationRun
  activeRun?: SimulationRun
  canCompare: boolean
  canEditRole: boolean
  openFile: () => void
  openSample: () => void
  setError: (message?: string) => void
  setDialog: (dialog?: ActiveDialog) => void
  setScopeTab: (tab: ScopeTab) => void
  toggleCompare: () => void
  clear: () => void
  onCapture: () => void
}): CommandActions {
  const { input } = design
  const available = !session.busy && runner.solver !== "running"
  return {
    open: available ? openFile : undefined,
    sample: available ? openSample : undefined,
    save: input && (() => exportDesign(input)),
    csv: activeRun && (() => exportWaveforms(activeRun)),
    png:
      activeFrame &&
      (() =>
        void exportWindow(activeFrame.id).catch((cause: Error) =>
          setError(cause.message),
        )),
    close:
      input && available
        ? () => {
            if (design.dirty) setDialog({ kind: "discard" })
            else session.closeBoard()
          }
        : undefined,
    undo:
      design.undo &&
      (() => {
        design.undo?.()
        setError(undefined)
      }),
    redo:
      design.redo &&
      (() => {
        design.redo?.()
        setError(undefined)
      }),
    reset:
      design.reset &&
      (() => {
        design.reset?.()
        setError(undefined)
      }),
    board: input && (() => windows.show("board")),
    board3d:
      input &&
      (() => {
        boardView.setMode("3D")
        windows.show("board")
      }),
    board2d:
      input &&
      (() => {
        boardView.setMode("2D")
        windows.show("board")
      }),
    fit:
      input &&
      (() => {
        boardView.fit()
        windows.show("board")
      }),
    hideFar:
      input &&
      (() => {
        boardView.setHideFar(!boardView.hideFar)
        windows.show("board")
      }),
    transparent:
      input &&
      (() => {
        boardView.setTransparent(!boardView.transparent)
        windows.show("board")
      }),
    stackup: input && (() => windows.show("stackup")),
    run:
      input && simulation && available
        ? () => {
            windows.show("log")
            void runner.start({ input, simulation, onCapture })
          }
        : undefined,
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
          toggleCompare()
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
    radius: simulation && (() => setDialog({ kind: "radius" })),
    assign:
      input &&
      (() =>
        setDialog({
          kind: "assign",
          port: chosenNode?.port,
          modelId: chosenNode?.modelId,
        })),
    ibis: input && (() => windows.show("ibis")),
    victim: canEditRole ? () => session.changeRole("selected") : undefined,
    aggressor: canEditRole ? () => session.changeRole("near") : undefined,
    exclude: canEditRole ? () => session.changeRole("excluded") : undefined,
    clear,
    shortcuts: () => setDialog({ kind: "shortcuts" }),
    guide: () => setDialog({ kind: "guide" }),
    about: () => setDialog({ kind: "about" }),
  }
}
