import { describe, it } from 'bun:test'
import { join } from 'node:path'
import { RuleTester, type Rule } from 'eslint'
import tseslint from 'typescript-eslint'
import plugin from '../../tools/eslint/rules.mjs'

// The custom rules in tools/eslint/rules.mjs, checked on small inputs.
RuleTester.describe = describe
RuleTester.it = it
/** Resolve Bun's focused runner only for a focused case, preserving its CI guard. */
RuleTester.itOnly = (name: string, run: () => void): void => {
  it.only(name, run)
}
const rules = plugin.rules as unknown as Record<string, Rule.RuleModule>
const root = join(import.meta.dirname, '..', '..')
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } })

tester.run('typed-signature', rules['typed-signature'], {
  valid: [
    'function f(a: number, b: string = "x"): void {}',
    'const g = (a: number): number => a',
    'class A { constructor(a: number) {} m(): void {} }',
    'xs.map(x => x * 2)',
  ],
  invalid: [
    { code: 'function f(a: number) {}', errors: [{ messageId: 'returns' }] },
    { code: 'const g = (a): number => a', errors: [{ messageId: 'param' }] },
    { code: 'class A { m(a) {} }', errors: [{ messageId: 'returns' }, { messageId: 'param' }] },
  ],
})

tester.run('max-file-lines', rules['max-file-lines'], {
  valid: ['const a = 1\n'.repeat(500)],
  invalid: [{ code: 'const a = 1\n'.repeat(501), errors: [{ messageId: 'tooLong' }] }],
})

tester.run('test-file-matches-source', rules['test-file-matches-source'], {
  valid: [
    { code: '', filename: join(root, 'tests/board/stackup.test.ts') },
    { code: '', filename: join(root, 'tests/board/index.test.ts') },
    { code: '', filename: join(root, 'tests/compat/anything.test.ts') },
  ],
  invalid: [
    {
      code: '',
      filename: join(root, 'tests/board/nothing-like-this.test.ts'),
      errors: [{ messageId: 'noSource' }],
    },
  ],
})

const limit = 120
const commentAtLimit = `// ${'x'.repeat(limit - 3)}`
const longUrl = `https://example.com/${'path/'.repeat(limit)}`

tester.run('max-line-length', rules['max-line-length'], {
  valid: [
    commentAtLimit,
    `// ${longUrl}`,
    `/* ${longUrl} */`,
    `/**\n * ${longUrl}\n */`,
    `// ${'é'.repeat(limit - 4)}😀`,
  ],
  invalid: [
    { code: `${commentAtLimit}x`, errors: [{ messageId: 'tooLong', line: 1, column: limit + 1 }] },
    { code: `// See ${longUrl}`, errors: [{ messageId: 'tooLong', line: 1 }] },
    { code: `const url = '${longUrl}'`, errors: [{ messageId: 'tooLong', line: 1 }] },
    {
      code: `// ${'😀'.repeat(limit - 2)}`,
      errors: [{ messageId: 'tooLong', line: 1, column: 3 + (limit - 3) * 2 + 1 }],
    },
    { code: `const x = 1\r\n${commentAtLimit}x`, errors: [{ messageId: 'tooLong', line: 2 }] },
  ],
})

tester.run('one-member-per-line', rules['one-member-per-line'], {
  valid: [
    'interface WithMethod {\n  x: number\n  method(): void\n}',
    'type Point = {\n  x: number\n  y: number\n}',
    'type One = { x: number }',
    'const point = { x, y }',
    'const point = {\n  x,\n  ...other,\n}',
  ],
  invalid: [
    { code: 'interface Point { x: number; y: number }', errors: [{ messageId: 'sharedLine', line: 1 }] },
    { code: 'type WithMethod = { x: number; method(): void }', errors: [{ messageId: 'sharedLine', line: 1 }] },
    {
      code: 'type Three = { x: number; y: number; z: number }',
      errors: [{ messageId: 'sharedLine' }, { messageId: 'sharedLine' }],
    },
    { code: 'const point = {\n  x, ...other,\n}', errors: [{ messageId: 'sharedLine', line: 2 }] },
    {
      code: 'const point = {\n  left: { x, y }, right: { x, y },\n}',
      errors: [{ messageId: 'sharedLine', line: 2 }],
    },
  ],
})
