import { cju } from "@tscircuit/circuit-json-util"
import type { CircuitJson } from "circuit-json"
import type { CircuitJsonSnapshot } from "./schema"

/** The query operations used to read records without editing the database. */
interface CircuitJsonTable<Record extends CircuitJson[number]> {
  get(id: string): Record | null
  getWhere(where: Partial<Record>): Record | null
  list(where?: Partial<Record>): Record[]
}

/** Circuit JSON queries expressed in record types shared with callers. */
export type CircuitJsonDb = {
  readonly [Type in CircuitJson[number]["type"]]: CircuitJsonTable<
    Extract<CircuitJson[number], { type: Type }>
  >
} & { toArray(): CircuitJson }

/** Give cju its own array for ID counters. Query callers treat the borrowed records as readonly. */
export function circuitJsonDb(circuit: CircuitJsonSnapshot): CircuitJsonDb {
  return cju(circuit.slice() as CircuitJson)
}
