import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { validateMatrix } from '../../src/extraction/index.js'

test('a reciprocal positive-definite matrix is symmetrized with its Cholesky proof', () => {
  const checked = validateMatrix({ a: [[7, 5], [5, 8]], name: 'R' })
  assert.deepEqual(checked.matrix, [[7, 5], [5, 8]])
  assert.equal(checked.reciprocityResidual, 0)
})

test('nonpassive, nonreciprocal, malformed and zero matrices fail before normalization', () => {
  assert.throws(() => validateMatrix({ a: [[1, 2], [2, 1]], name: 'L' }), /passivity/)
  assert.throws(() => validateMatrix({ a: [[1, .2], [.5, 1]], name: 'C' }), /reciprocity/)
  assert.throws(() => validateMatrix({ a: [[1, 2]], name: 'X' }), {
    code: 'matrix_format',
    message: 'matrix_format: X: finite square matrix required',
  })
  assert.throws(() => validateMatrix({ a: [[0]], name: 'X' }), { code: 'matrix_zero' })
})
