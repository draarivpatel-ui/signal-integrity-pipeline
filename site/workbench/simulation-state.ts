import { useEffect, useRef, useState } from "react"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"
import {
  type LogEntry,
  localSolverStatus,
  runLocalSimulation,
  type SimulationRun,
} from "./local-run"

type SolverState = "checking" | "ready" | "offline" | "running"

/** Own the local solver lifecycle and retain the captures for this board session. */
export function useSimulation(): {
  entries: LogEntry[]
  runs: SimulationRun[]
  stage: string
  completed: number
  solver: SolverState
  summary: string
  version?: string
  check: (record?: boolean) => Promise<void>
  start: (input: {
    input: InspectorInput
    simulation: ChannelSimulation
    onCapture: () => void
  }) => Promise<void>
  stop?: () => void
  reset: () => void
  clearLog: () => void
} {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [runs, setRuns] = useState<SimulationRun[]>([])
  const [stage, setStage] = useState("")
  const [completed, setCompleted] = useState(0)
  const [solver, setSolver] = useState<SolverState>("checking")
  const [summary, setSummary] = useState("")
  const [version, setVersion] = useState<string>()
  const active = useRef<AbortController>(undefined)

  /** Append an immutable log event with its local display timestamp. */
  const log = (entry: Omit<LogEntry, "time">): void =>
    setEntries((rows) => [...rows, { ...entry, time: Date.now() }])
  /** Refresh backend status for the status strip or detailed log. */
  const check = async (record?: boolean): Promise<void> => {
    try {
      const status = await localSolverStatus()
      if (active.current) return
      setSolver(status.available ? "ready" : "offline")
      setVersion(status.version)
      if (record)
        log({
          stage: "Backend",
          level: status.available ? "OK" : "Error",
          message:
            status.version ??
            "ngspice is unavailable on the local server PATH.",
        })
    } catch (cause) {
      if (active.current) return
      setSolver("offline")
      if (record)
        log({
          stage: "Backend",
          level: "Error",
          message: (cause as Error).message,
        })
    }
  }
  useEffect(() => {
    void check()
  }, [])
  return {
    entries,
    runs,
    stage,
    completed,
    solver,
    summary,
    version,
    check,
    start: async ({ input, simulation, onCapture }) => {
      if (active.current) return
      const controller = new AbortController()
      active.current = controller
      setSolver("running")
      setStage("Setup")
      setCompleted(0)
      setSummary("")
      try {
        const result = await runLocalSimulation({
          input,
          simulation,
          signal: controller.signal,
          log,
          progress: (count, name) => {
            setCompleted(count)
            setStage(name)
          },
        })
        setRuns((previous) => [
          ...previous,
          {
            ...result,
            id: (previous.at(-1)?.id ?? 0) + 1,
            timestamp: Date.now(),
          },
        ])
        setSummary("Capture complete")
        onCapture()
      } catch {
        setSummary(
          controller.signal.aborted
            ? "Simulation stopped"
            : "Simulation failed",
        )
      } finally {
        active.current = undefined
        setSolver("checking")
        void check()
      }
    },
    stop: solver === "running" ? () => active.current?.abort() : undefined,
    reset: () => {
      setEntries([])
      setRuns([])
      setStage("")
      setCompleted(0)
      setSummary("")
    },
    clearLog: () => setEntries([]),
  }
}
