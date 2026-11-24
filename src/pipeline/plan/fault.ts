import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { PlanOverlay, SourcePortId, SourceTraceId } from "../../board"
import type { Diagnostic } from "../../kernel"
import type { PlanPath, PlanTopology } from "./visual"

/** Fault ports and routes are selected only from the current attempt's evidence. */
export interface PlanFault {
  ports: Set<SourcePortId>
  traces: Set<SourceTraceId>
  overlays: PlanOverlay[]
  incompletePaths: PlanPath[]
}

/** Diagnose open legs and collapsed or bypassed connections from the evidence. */
export function resolvePlanFault({
  db,
  issue,
  paths,
  topology,
  partiallyRoutedPorts,
}: {
  db: CircuitJsonUtilObjects
  partiallyRoutedPorts: ReadonlySet<SourcePortId>
  issue?: Diagnostic
  paths: readonly PlanPath[]
  topology?: PlanTopology
}): PlanFault {
  const ports = new Set<SourcePortId>()
  const traces = new Set<SourceTraceId>()
  const overlays: PlanOverlay[] = []
  for (const { id, kind } of issue?.subjects || []) {
    if (kind !== "record") continue
    if (db.source_port.get(id)) ports.add(id)
    if (db.source_trace.get(id)) traces.add(id)
  }
  const incompletePaths: PlanPath[] = []
  if (issue?.code === "channel_short") {
    for (const link of topology?.overlays || []) {
      if (
        link.kind !== "ideal" ||
        !ports.has(link.fromSourcePortId) ||
        !ports.has(link.toSourcePortId)
      )
        continue
      overlays.push({ ...link, kind: "short", label: "Bypass" })
    }
  } else if (
    issue?.code === "channel_net" ||
    issue?.code === "channel_receiver_terminal_missing"
  ) {
    for (const path of paths) {
      const { signalName, fromSourcePortId, toSourcePortId } = path
      if (!ports.has(fromSourcePortId) || !ports.has(toSourcePortId)) continue
      incompletePaths.push(path)
      if (
        partiallyRoutedPorts.has(fromSourcePortId) ||
        partiallyRoutedPorts.has(toSourcePortId)
      )
        continue
      overlays.push({
        fromSourcePortId,
        toSourcePortId,
        kind: "missing",
        label: `${signalName} · No routed source path`,
      })
    }
  }
  return { ports, traces, overlays, incompletePaths }
}
