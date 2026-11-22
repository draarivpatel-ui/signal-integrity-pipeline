import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type { CircuitJson } from "circuit-json"
import type { CircuitJsonSnapshot } from "./schema"

/** Give cju its own array for ID counters. Query callers treat the borrowed records as readonly. */
export function circuitJsonDb(
  circuit: CircuitJsonSnapshot,
): CircuitJsonUtilObjects {
  return cju(circuit.slice() as CircuitJson)
}
