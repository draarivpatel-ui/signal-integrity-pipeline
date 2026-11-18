import type { SourceNet, SourcePort, SourceTrace } from "circuit-json"

/** The identifier of a source port in Circuit JSON. */
export type SourcePortId = SourcePort["source_port_id"]

/** The identifier of a source net in Circuit JSON. */
export type SourceNetId = SourceNet["source_net_id"]

/** The identifier of a source trace in Circuit JSON. */
export type SourceTraceId = SourceTrace["source_trace_id"]
