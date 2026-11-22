import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type { CircuitJson } from "../board"

/** Create a query database without attaching cju's ID counters to the caller's array. */
export function circuitJsonDb(circuit: CircuitJson): CircuitJsonUtilObjects {
  return cju(circuit.slice())
}
