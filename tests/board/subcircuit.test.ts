import test from 'node:test'
import assert from 'node:assert/strict'
import type { SourceGroup } from 'circuit-json'
import { subcircuitTree } from '../../src/board'

/** Source-group identity and ownership used by the scope lookup. */
type GroupRecord = Pick<SourceGroup, 'type' | 'source_group_id' | 'parent_source_group_id' | 'subcircuit_id'>

/** Creates a group, optionally with a subcircuit named from its id. */
function group({ id, parent, subcircuit = true }: {
  id: SourceGroup['source_group_id']
  parent?: SourceGroup['parent_source_group_id']
  subcircuit?: boolean
}): GroupRecord {
  const record: GroupRecord = {
    type: 'source_group',
    source_group_id: id,
    parent_source_group_id: parent,
  }
  if (subcircuit) record.subcircuit_id = `sub_${id}`
  return record
}

// board > (cpu, plain > ram). Only plain does not own a subcircuit.
const tree = subcircuitTree([
  group({ id: 'board' }),
  group({ id: 'cpu', parent: 'board' }),
  group({ id: 'plain', parent: 'board', subcircuit: false }),
  group({ id: 'ram', parent: 'plain' }),
])

test('resolves the closest common subcircuit', () => {
  assert.equal(tree.common(['sub_cpu', 'sub_ram']), 'sub_board')
  assert.equal(tree.common(['sub_ram', 'sub_ram']), 'sub_ram')
  assert.equal(tree.common(['sub_ram', 'sub_board']), 'sub_board')
  assert.equal(tree.common(['sub_ram', undefined]), undefined)
})

test('checks subcircuit containment', () => {
  assert.ok(tree.within({ inner: 'sub_ram', outer: 'sub_board' }))
  assert.ok(tree.within({ inner: 'sub_ram', outer: 'sub_ram' }))
  assert.ok(tree.within({ inner: 'sub_ram', outer: null }), 'the unscoped root contains every subcircuit')
  assert.ok(!tree.within({ inner: 'sub_board', outer: 'sub_ram' }))
  assert.ok(!tree.within({ inner: 'sub_cpu', outer: 'sub_ram' }))
  assert.ok(!tree.within({ inner: undefined, outer: 'sub_board' }))
})

test('unrelated top-level subcircuits only share the unscoped root', () => {
  const tree = subcircuitTree([group({ id: 'a' }), group({ id: 'b' })])
  assert.equal(tree.common(['sub_a', 'sub_b']), undefined)
})
