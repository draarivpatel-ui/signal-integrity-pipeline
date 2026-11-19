// One minimal trigger per board diagnostic code not already exercised by the other board tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRouteVias, selectPort, subcircuitTree, type PcbTrace } from '../../src/board'

test('rejects a missing source component', () => {
  assert.throws(
    () => selectPort({ circuit: [], selector: { component: 'missing', port: '1' } }),
    { code: 'pin_mapping', message: /missing: expected one source component, got 0/ },
  )
})

test('rejects unsupported routed primitives', () => {
  const trace: PcbTrace = {
    type: 'pcb_trace',
    pcb_trace_id: 'pcb_trace_0',
    route: [{
      route_type: 'through_pad',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      width: .2,
      start_layer: 'top',
      end_layer: 'bottom',
    }],
  }
  assert.throws(
    () => resolveRouteVias({ circuit: [], trace }),
    { code: 'route_type', message: /Only wire\/via routed primitives supported/ },
  )
})

test('rejects cyclic source-group ownership', () => {
  assert.throws(() => subcircuitTree([
    {
      type: 'source_group',
      source_group_id: 'a',
      subcircuit_id: 'sa',
      parent_source_group_id: 'b',
    },
    { type: 'source_group', source_group_id: 'b', parent_source_group_id: 'a' },
  ]), { code: 'simulation_scope', message: /Cyclic source-group ownership/ })
})
