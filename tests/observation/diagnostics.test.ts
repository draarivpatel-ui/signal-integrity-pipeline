import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as observation from '../../src/observation'

test('legacy waveform folding is removed', () => {
  assert.deepEqual(Object.keys(observation), [])
})
