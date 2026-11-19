import { type DiagnosticInit, diagnostics } from "../kernel"

const raise = diagnostics("extraction", [
  "matrix_format",
  "matrix_zero",
  "reciprocity",
  "passivity",
] as const)
export type ExtractionCode = Parameters<typeof raise>[0]
/** Declared as a function so `never` narrows control flow at call sites. */
export function fail(
  code: ExtractionCode,
  text: string,
  init?: DiagnosticInit,
): never {
  return raise(code, text, init)
}
