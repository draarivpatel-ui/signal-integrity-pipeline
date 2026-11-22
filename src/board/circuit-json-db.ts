import { cju } from "@tscircuit/circuit-json-util"
import type { CircuitJson } from "circuit-json"
import type { Snapshot } from "../kernel"
import type { CircuitJsonSnapshot } from "./schema"

/** The query operations used to read records without editing the database. */
interface CircuitJsonTable<Record extends CircuitJson[number]> {
  get(id: string): Snapshot<Record> | undefined
  getWhere(where: Partial<Snapshot<Record>>): Snapshot<Record> | undefined
  list(where?: Partial<Snapshot<Record>>): Snapshot<Record>[]
}

/** Circuit JSON queries expressed in record types shared with callers. */
export type CircuitJsonDb = {
  readonly [Type in CircuitJson[number]["type"]]: CircuitJsonTable<
    Extract<CircuitJson[number], { type: Type }>
  >
} & { toArray(): CircuitJsonSnapshot }

/** Give cju its own array for ID counters. Query callers treat the borrowed records as readonly. */
export function circuitJsonDb(circuit: CircuitJsonSnapshot): CircuitJsonDb {
  // Pinned cju uses Array.find for get/getWhere despite its nullable declarations.
  return cju(circuit.slice() as CircuitJson) as unknown as CircuitJsonDb
}
