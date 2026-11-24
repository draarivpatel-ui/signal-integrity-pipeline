import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId, SourceTraceId } from "./ids"
import type { PlanHeaderRow } from "./plan-header"

/** Colours distinguish secondary copper and topology on a light canvas. */
export const planColors = {
  ink: "#0f172a",
  quiet: "#475569",
  scope: "#0f766e",
  nearby: "#48958e",
  rail: "#a45a70",
  existing: "#39789a",
  excluded: "#cbd5e1",
  series: "#b45309",
  ideal: "#4338ca",
  failure: "#b91c1c",
} as const

/** Translucent pours leave traces and layer overlaps visible. */
export const planPourFills = {
  pink: "rgba(219,39,119,0.06)",
  gray: "rgba(100,116,139,0.08)",
} as const

/** Distinct strokes for adjacent cuts, with the same colours in the ledger. */
const CUT_COLORS = [
  "#0369a1",
  "#b45309",
  "#047857",
  "#6d28d9",
  "#be185d",
  "#0e7490",
]

/** Assign the same colour to a cut, its terminals and its ledger row. */
export function planCutColor(index: number): string {
  return CUT_COLORS[index % CUT_COLORS.length]
}

/** A physical conductor partition, oriented for its first mapped path. */
export interface PlanVisualCut {
  trace: SourceTraceId
  from: SourcePortId
  to: SourcePortId
  index: number
  mapped: boolean
}

/** A point-to-point topology overlay independent of the physical copper. */
export interface PlanVisualLink {
  from: SourcePortId
  to: SourcePortId
  kind: "series" | "ideal" | "missing" | "short"
  label: string
}

/** A pin's role and the cut or path colour to use for its marker. */
export interface PlanVisualEndpoint {
  id: SourcePortId
  kind: "driver" | "receiver" | "ideal" | "extraTraceEnd"
  color: string
  label: string
  toward?: SourcePortId
}

/** Board geometry and resolved decisions from a single planning attempt. */
export interface PlanVisualScene {
  db: CircuitJsonUtilObjects
  title: string
  diagnostic?: { text: string; label: string }
  scope?: Snapshot<CopperScope>
  cuts: readonly PlanVisualCut[]
  endpoints: readonly PlanVisualEndpoint[]
  links: readonly PlanVisualLink[]
  summary?: { text: string; scopedText?: string }
  rows: readonly PlanHeaderRow[]
  faultCode?: string
  faultPorts: ReadonlySet<SourcePortId>
  faultTraces: ReadonlySet<SourceTraceId>
  existingTraces: ReadonlySet<SourceTraceId>
}
