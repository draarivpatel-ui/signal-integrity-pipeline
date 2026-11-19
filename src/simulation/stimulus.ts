// Was src/stimulus.ts.
import { fail, type SimulationCode } from './diagnostics'

/** Bound the size of accepted transmission patterns before validating individual bits. */
const MAX_TRANSMITTED_BITS = 65536

/** Public. Normalizes a transmission pattern to a '0'/'1' string (<= 65536 bits). */
export function transmittedBits(value: unknown, code: SimulationCode = 'stimulus_pattern'): string {
  if ((Array.isArray(value) || typeof value === 'string') && value.length > MAX_TRANSMITTED_BITS)
    fail(code, 'Transmission patterns must contain at most 65536 bits')
  if (Array.isArray(value) && value.length && Array.from(value).every(bit => bit === 0 || bit === 1)) {
    return value.join('')
  }
  if (typeof value === 'string' && value.length > 0 && Array.from(value).every(bit => bit === '0' || bit === '1')) {
    return value
  }
  fail(code, 'A nonempty binary string or array of numeric 0/1 bits is required')
}
