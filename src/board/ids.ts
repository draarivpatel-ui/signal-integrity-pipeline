import type {
  PcbCopperPour,
  PcbPlatedHole,
  PcbPort,
  PcbSmtPad,
  PcbTrace,
  PcbVia,
  SourceNet,
  SourcePort,
  SourceTrace,
} from "circuit-json"

/** The identifier of a source port in Circuit JSON. */
export type SourcePortId = SourcePort["source_port_id"]

/** The identifier of a source net in Circuit JSON. */
export type SourceNetId = SourceNet["source_net_id"]

/** The identifier of a source trace in Circuit JSON. */
export type SourceTraceId = SourceTrace["source_trace_id"]

/** The identifier of a PCB port in Circuit JSON. */
export type PcbPortId = PcbPort["pcb_port_id"]

/** The identifier of a PCB trace in Circuit JSON. */
export type PcbTraceId = PcbTrace["pcb_trace_id"]

/** The identifier of a PCB via in Circuit JSON. */
export type PcbViaId = PcbVia["pcb_via_id"]

/** The identifier of a PCB copper pour in Circuit JSON. */
export type PcbCopperPourId = PcbCopperPour["pcb_copper_pour_id"]

/** The identifier of a surface-mount pad or plated hole in Circuit JSON. */
export type CopperPadId =
  | PcbSmtPad["pcb_smtpad_id"]
  | PcbPlatedHole["pcb_plated_hole_id"]
