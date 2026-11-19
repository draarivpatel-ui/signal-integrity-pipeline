import { fail } from "./fail"

const ID_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
declare const idBrand: unique symbol
/** ASCII letters, digits, underscores or hyphens, safe in paths and SPICE identifiers. */
export type SafeId = string & { readonly [idBrand]: true }
/** Checks the ASCII characters permitted in a serialized simulation identifier. */
function isSafeId(id: string): boolean {
  if (!id.length) return false
  for (const char of id) if (!ID_CHARACTERS.includes(char)) return false
  return true
}
/** Boundary parse. Inside the library every id that reaches a path or netlist is a SafeId. */
export function safeId({
  raw,
  field,
}: {
  raw: unknown
  field: string
}): SafeId {
  void field // message kept byte-identical to the pre-module pipeline
  if (typeof raw !== "string" || !isSafeId(raw))
    fail(
      "simulation_id",
      "Serialized simulation IDs must be safe stable identifiers",
    )
  return raw as SafeId
}
