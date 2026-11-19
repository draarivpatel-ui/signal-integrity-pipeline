// Circuit JSON record admission (was schema.ts + circuit-schema.mjs). Validation never edits input.
import type { z } from 'zod'
import * as base from 'circuit-json'
import type { CircuitJson } from 'circuit-json'
import { fail } from './diagnostics'
export type { CircuitJson, SimulationExperiment, SimulationIbisModel } from 'circuit-json'

/** Picks the circuit-json schema by record type, or by ftype for source components. */
export function recordSchema(record: {
  type: string
  ftype?: string
}): z.ZodTypeAny | undefined {
  let schemaName = record.type
  if (record.type === 'source_component') schemaName = `source_${record.ftype}`
  return base[schemaName as keyof typeof base] as z.ZodTypeAny | undefined
}
/** Select the registered record schema directly, avoiding a union diagnostic
 * containing hundreds of unrelated alternatives. Validation never edits input. */
export function validateCircuitRecords(records: unknown): void {
  if(!Array.isArray(records)) fail('circuit_schema','Expected a Circuit JSON record array')
  for(const record of records as Array<Record<string, unknown> | null | undefined>) {
    const type=record?.type
    const id=record?.[`${type}_id`]??record?.name??'(unnamed)'
    const schema: Partial<z.ZodTypeAny> | undefined=typeof type==='string'?recordSchema(record as {
      type: string
      ftype?: string
    }):undefined
    if(!schema?.safeParse) fail('circuit_schema',`${type??'(missing type)'} ${id}: no registered record schema`)
    const parsed=schema.safeParse(record)
    if(!parsed.success) {
      const issue=parsed.error.issues[0]
      const path=issue.path?.join('.')
      fail('circuit_schema',`${type} ${id}: ${path?path+': ':''}${issue.message}`)
    }
  }
}
