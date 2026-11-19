import test from 'node:test'
import assert from 'node:assert/strict'
import * as pipeline from '../../src/pipeline'

test('the pipeline has no public stages yet', () => {
  assert.deepEqual(Object.keys(pipeline), [])
})
