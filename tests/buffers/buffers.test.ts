import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { admitBuffers, assertConverter } from '../../src/buffers'
import { rootScope } from '../../src/kernel'

test('a converter without the conversion function is rejected', () => {
  assert.throws(() => assertConverter({}), { code: 'converter_version' })
})

test('a mismatched vendor hash is rejected', () => {
  const path = 'models/driver.ibs'
  assert.throws(() => admitBuffers({
    models: [{
      pipelineId: 'driver',
      ibis_model_asset: { project_relative_path: path, url: 'https://example.test/driver.ibs', mimetype: 'text/plain' },
    }],
    ibisSources: { [path]: '[IBIS Ver] 4.2\n[End]\n' },
    modeling: { ibisModelAssetSha256: { [path]: '0'.repeat(64) } },
    scope: rootScope('buffers'),
  }), { code: 'vendor_hash' })
})
