/* eslint-disable local/max-file-lines -- The module checks share AST parsing, diagnostics and reporting. */
/**
 * bun run check:modules [--write]
 * The module list is the filesystem. Nothing here enumerates modules by name.
 *
 * A module is a directory src/<dir>/ containing index.ts.
 * Fails the build (exit 1, one line per violation) unless, for EVERY module:
 *   M1  exactly one `diagnostics('<dir>', [ ...literal strings ])` call. Codes may be shared across
 *       modules (today 10 codes have raisers in >1 file); the generated DiagnosticCode union is the
 *       de-duplicated set and tests/compat/codes.test.ts asserts it EQUALS today's raised-code set
 *   M2  tests/<dir>/ exists with >= 1 test file (every module is tested; no list of modules anywhere)
 *   M3  every code in the module's diagnostics tuple is raised by at least one test in tests/<dir>/
 *       (grep for the literal in an assertion: rejects(..., {code:'x'})) — no declared-but-untested failure
 *   EX  tools/exemptions.json may waive M1-M3 for a module with an ISO expiry date; expired => fail (migration)
 * and for src/ as a whole:
 *   S1  no directory under src/ without index.ts (no unowned code); src/*.ts only index.ts + modules.generated.ts
 *   S2  a cross-module import must target the module folder `../<other>` (internals unreachable)
 *   S3  the module import graph is acyclic (derived from imports; there is no declared layer list)
 *   S4  `node:*` and fs/child_process imports appear only in src/adapters/**
 *   S5  src/index.ts imports only `./<module>` and ./modules.generated
 *   S6  src/modules.generated.ts equals the generated DomainName + DiagnosticCode unions (--write regenerates)
 *
 * Migration (tools/exemptions.json, see ARCHITECTURE.md "Staged migration"):
 *   { "legacy":  { "expires": "YYYY-MM-DD", "paths": ["src/old.ts", "src/legacy/", ...] },
 *     "modules": { "<dir>": { "expires": "YYYY-MM-DD", "waive": ["M2", "M3"] } } }
 *   A legacy path (file, or directory with a trailing '/') is exempt from S1 and S4, may be imported by
 *   src/index.ts (S5), and is never a module. A module waiver suppresses the listed M-rules. Entries are
 *   valid through their expiry day (UTC); after it they fail EX and stop waiving anything.
 */
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export interface ModuleInfo {
  dir: string
  root: string
  tests: string
}
export type Rule = `M${1|2|3}` | 'EX' | `S${1|2|3|4|5|6}`
export interface Violation {
  rule: Rule
  module?: string
  message: string
}

export interface Exemptions {
  legacy?: {
    expires: string
    paths: string[]
  }
  modules?: Record<string, {
    expires: string
    waive: string[]
  }>
}
export interface CheckOptions {
  /** Today's date as YYYY-MM-DD (UTC). Defaults to the current date. */
  today?: string
  exemptions?: Exemptions
}

const SOURCE_EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']
const WORD_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_'
const ASSERTIONS = ['assert', 'expect', 'rejects', 'throws', 'doesNotThrow', 'doesNotReject', 'equal', 'strictEqual',
  'deepEqual', 'deepStrictEqual', 'match', 'ok', 'partialDeepStrictEqual']

/** Checks the letters, digits and underscore that form an ASCII word. */
const isWordCharacter = (char: string): boolean => char.length === 1 && WORD_CHARACTERS.includes(char)
/** Whether the filename ends in a JS or TS source extension. */
const isSourceFile = (name: string): boolean => SOURCE_EXTENSIONS.some(ext => name.endsWith(ext))
/** Whether the filename ends in a JS or TS test extension. */
const isTestFile = (name: string): boolean => SOURCE_EXTENSIONS.some(ext => name.endsWith(`.test${ext}`))

/** Recognizes an assertion name ending at a word boundary. */
function startsWithWord({ text, word }: {
  text: string
  word: string
}): boolean {
  return text.startsWith(word) && !isWordCharacter(text[word.length] ?? '')
}

/** A string literal or a word from a regular expression in a test assertion. */
type AssertionLiteral = string

/** Extracts ASCII words from a test assertion's regular expression literal. */
function collectWords({ text, words }: {
  text: string
  words: Set<AssertionLiteral>
}): void {
  let word = ''
  for (const char of text) {
    if (isWordCharacter(char)) {
      word += char
      continue
    }
    if (word) {
      words.add(word)
      word = ''
    }
  }
  if (word) words.add(word)
}
/** Normalizes a native path to forward slashes so reports and comparisons match on every OS. */
const toPosix = (p: string): string => p.split(sep).join('/')
/** ISO dates use a four-digit year, two-digit month and two-digit day. */
const ISO_DATE_LENGTH = 10
const ISO_MONTH_SEPARATOR = 4
const ISO_DAY_SEPARATOR = 7

/** Today's date as YYYY-MM-DD in UTC, the format exemption expiry dates are compared against. */
const todayUtc = (): string => new Date().toISOString().slice(0, ISO_DATE_LENGTH)

/** True when the value is a real YYYY-MM-DD date string, so malformed expiry dates are caught. */
function isoDate(s: unknown): s is string {
  if (typeof s !== 'string' || s.length !== ISO_DATE_LENGTH) return false
  if (s[ISO_MONTH_SEPARATOR] !== '-' || s[ISO_DAY_SEPARATOR] !== '-') return false
  const year = s.slice(0, ISO_MONTH_SEPARATOR)
  const month = s.slice(ISO_MONTH_SEPARATOR + 1, ISO_DAY_SEPARATOR)
  const day = s.slice(ISO_DAY_SEPARATOR + 1)
  const digits = year + month + day
  for (const digit of digits) if (digit < '0' || digit > '9') return false
  return !Number.isNaN(Date.parse(s))
}

/** Single source: every src/<dir>/index.ts. Tests live in the sibling tests/<dir>/. */
export function discoverModules(src: string, tests: string = join(dirname(src), 'tests')): ModuleInfo[] {
  return readdirSync(src, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(src, d.name, 'index.ts')))
    .map(d => ({ dir: d.name, root: join(src, d.name), tests: join(tests, d.name) }))
    .sort((a, b) => a.dir.localeCompare(b.dir))
}

/** Lists every file under a directory whose name passes the predicate, sorted; a missing directory yields none. */
function walk({ dir, keep }: {
  dir: string
  keep: (name: string) => boolean
}): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const path = join(dir, d.name)
    if (d.isDirectory()) return walk({ dir: path, keep })
    if (!keep(d.name)) return []
    return [path]
  }).sort()
}
/** Reads a file and parses it into a TypeScript AST with parent links set. */
const parse = (file: string): ts.SourceFile => ts.createSourceFile(
  file,
  readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)

/** Calls the callback on a node and every descendant, depth first. */
function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node)
  ts.forEachChild(node, c => visit(c, fn))
}

/** `x as const`, `x satisfies T`, `(x)` → x */
function unwrap(e: ts.Expression): ts.Expression {
  while (
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isParenthesizedExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    e = e.expression
  }
  return e
}

export interface DiagnosticsCall {
  file: string
  domain?: string
  codes?: string[]
  problem?: string
}

/** Every `diagnostics(...)` call in a module's sources, with its literal tuple parsed from the AST. */
export function findDiagnosticsCalls(root: string): DiagnosticsCall[] {
  const calls: DiagnosticsCall[] = []
  for (const file of walk({ dir: root, keep: isSourceFile })) visit(parse(file), n => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'diagnostics') return
    const [d, list] = n.arguments
    const call: DiagnosticsCall = { file }
    if (d && ts.isStringLiteralLike(d)) call.domain = d.text
    const arr = list && unwrap(list)
    if (arr && ts.isArrayLiteralExpression(arr) && arr.elements.every(ts.isStringLiteralLike))
      call.codes = arr.elements.map(e => (e as ts.StringLiteralLike).text)
    if (call.domain === undefined) call.problem = 'first argument must be a string literal domain'
    else if (!call.codes) call.problem = 'second argument must be an array literal of string literals'
    calls.push(call)
  })
  return calls
}

/** Parsed exemptions and any reported file error. */
type LoadedExemptions = {
  value: Exemptions
  problem?: string
}

/** Reads tools/exemptions.json, treating a missing file as no exemptions and reporting unparsable JSON as a problem. */
function loadExemptions(path: string): LoadedExemptions {
  if (!existsSync(path)) return { value: {} }
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as Exemptions }
  }
  catch (e) { return { value: {}, problem: `${toPosix(path)}: ${(e as Error).message}` } }
}

/** A rule name supplied by a module waiver. */
type WaiverRuleName = string

/** Paths and module waivers still in force, plus exemption violations. */
type ActiveExemptions = {
  legacy: string[]
  waivers: Map<ModuleInfo['dir'], Set<WaiverRuleName>>
  violations: Violation[]
}

/** True when an entry's expiry is valid and not yet passed; otherwise records an EX violation. */
function exemptionIsLive({ expires, module, what, today, violations }: {
  expires: unknown
  module: string
  what: string
  today: string
  violations: Violation[]
}): boolean {
  if (!isoDate(expires)) {
    violations.push({
      rule: 'EX',
      module,
      message: `${what}: "expires" must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(expires)}`,
    })
    return false
  }
  if (today > expires) {
    violations.push({
      rule: 'EX',
      module,
      message: `${what} expired on ${expires}; finish the move and delete the entry from tools/exemptions.json`,
    })
    return false
  }
  return true
}

/** Validates expiry; returns the waivers that are still in force plus EX violations. */
export function activeExemptions({ ex, today = todayUtc() }: {
  ex: Exemptions
  today?: string
}): ActiveExemptions {
  const violations: Violation[] = []
  const waivers = new Map<ModuleInfo['dir'], Set<WaiverRuleName>>()
  let legacy: string[] = []
  if (ex.legacy && exemptionIsLive({
    expires: ex.legacy.expires,
    module: 'src',
    what: 'legacy exemption',
    today,
    violations,
  })) legacy = (ex.legacy.paths ?? []).map(toPosix)
  for (const [dir, w] of Object.entries(ex.modules ?? {})) {
    const what = `waiver of ${(w?.waive ?? []).join('/') || 'nothing'}`
    if (!exemptionIsLive({ expires: w?.expires, module: dir, what, today, violations })) continue
    const bad = (w.waive ?? []).filter(r => !['M1', 'M2', 'M3'].includes(r))
    if (bad.length) violations.push({
      rule: 'EX',
      module: dir,
      message: `only M1-M3 can be waived, not ${bad.join(', ')}`,
    })
    waivers.set(dir, new Set(w.waive ?? []))
  }
  return { legacy, waivers, violations }
}

/** True when `rel` (posix, relative to the repo root) is a listed legacy file or lies in a listed legacy dir. */
const isLegacy = (rel: string, legacy: readonly string[]): boolean =>
  legacy.some(p => p.endsWith('/') ? rel === p.slice(0, -1) || rel.startsWith(p) : rel === p)

/** True for calls to assert.*, expect, rejects, throws and related assertion helpers. */
function isAssertion({ node, source }: {
  node: ts.Node
  source: ts.SourceFile
}): boolean {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression.getText(source)
  return callee.split('.').some(part => ASSERTIONS.some(word => startsWithWord({ text: part, word })))
}

/** Records strings and words from regex literals in an assertion or table of assertion inputs. */
function collectAssertionLiterals({ root, found }: {
  root: ts.Node
  found: Set<AssertionLiteral>
}): void {
  visit(root, n => {
    if (ts.isStringLiteralLike(n)) {
      found.add(n.text)
      return
    }
    if (ts.isRegularExpressionLiteral(n)) collectWords({ text: n.text, words: found })
  })
}

/** Literals in assertion arguments or in the iterable of a table-driven assertion loop. */
type AssertionLiterals = Set<AssertionLiteral>

/**
 * Finds asserted diagnostic names, both directly in assertion arguments and in a for-of table
 * when the loop body makes an assertion.
 */
function assertedLiterals(file: string): AssertionLiterals {
  const found: AssertionLiterals = new Set()
  const source = parse(file)
  visit(source, node => {
    if (ts.isCallExpression(node) && isAssertion({ node, source })) {
      node.arguments.forEach(root => collectAssertionLiterals({ root, found }))
    }
    if (!ts.isForOfStatement(node)) return
    let asserts = false
    visit(node.statement, statement => {
      if (isAssertion({ node: statement, source })) asserts = true
    })
    if (asserts) collectAssertionLiterals({ root: node.expression, found })
  })
  return found
}

/** What was found and which module rule it violates. */
interface ModuleViolation {
  rule: 'M1' | 'M2' | 'M3'
  message: string
}

/** Creates a reporter that applies the module's active waivers. */
function createModuleViolationReporter({ module, waived, out }: {
  module: string
  waived: ReadonlySet<WaiverRuleName>
  out: Violation[]
}): (violation: ModuleViolation) => void {
  return ({ rule, message }) => {
    if (!waived.has(rule)) out.push({ rule, module, message })
  }
}

/** Checks one module against M1-M3, skipping rules its exemption waives. */
export function checkModule({ m, options = {} }: {
  m: ModuleInfo
  options?: CheckOptions
}): Violation[] {
  const { waivers } = activeExemptions({ ex: options.exemptions ?? {}, today: options.today })
  const waived = waivers.get(m.dir) ?? new Set<WaiverRuleName>()
  const out: Violation[] = []
  const push = createModuleViolationReporter({ module: m.dir, waived, out })

  const calls = findDiagnosticsCalls(m.root)
  if (calls.length !== 1) {
    const files = calls.map(call => toPosix(call.file))
    let locations = ''
    if (files.length) locations = ` (${files.join(', ')})`
    const expected = `expected exactly one diagnostics('${m.dir}', [...] as const) call`
    push({ rule: 'M1', message: `${expected}, found ${calls.length}${locations}` })
  }
  for (const c of calls) {
    if (c.problem) {
      push({ rule: 'M1', message: `${toPosix(c.file)}: ${c.problem}` })
      continue
    }
    if (c.domain !== m.dir) push({
      rule: 'M1',
      message: `${toPosix(c.file)}: diagnostics domain '${c.domain}' must be the directory name '${m.dir}'`,
    })
  }

  const tests = walk({ dir: m.tests, keep: isTestFile })
  if (!tests.length) {
    push({ rule: 'M2', message: `${toPosix(m.tests)}/ has no *.test.* file` })
    return out
  }

  const codes = [...new Set(calls.flatMap(c => c.codes ?? []))]
  if (codes.length) {
    const asserted = new Set<AssertionLiteral>()
    for (const t of tests) for (const s of assertedLiterals(t)) asserted.add(s)
    for (const code of codes) if (!asserted.has(code)) push({
      rule: 'M3',
      message: `declared code '${code}' is not asserted by any test in ${toPosix(m.tests)}/`,
    })
  }
  return out
}

interface ImportEdge {
  file: string
  specifier: string
  target?: string
}
/** Lists a file's import specifiers, resolving relative ones to absolute targets. */
function importsOf(file: string): ImportEdge[] {
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true)
  return info.importedFiles.map(({ fileName }): ImportEdge => {
    let target: string | undefined
    if (fileName.startsWith('.')) target = resolveTarget(resolve(dirname(file), fileName))
    return { file, specifier: fileName, target }
  })
}

/** Imports are extensionless; a directory import (`../board`) means its index file. */
function resolveTarget(abs: string): string {
  if (existsSync(abs) && statSync(abs).isDirectory()) return join(abs, 'index')
  return abs
}
/** Whether the specifier names a Node built-in covered by the module rules. */
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || ['fs', 'child_process']
    .some(name => specifier === name || specifier.startsWith(`${name}/`))
}

/** Strip a JS/TS extension so `x.js` (specifier) and `x.ts` (file on disk) compare equal. */
function stem(p: string): string {
  const ext = SOURCE_EXTENSIONS.find(extension => p.endsWith(extension))
  if (!ext) return p
  return p.slice(0, -ext.length)
}
/** Converts the JS output path back to its TypeScript source extension. */
function jsToTs(p: string): string {
  const extension = '.js'
  if (!p.endsWith(extension)) return p
  return `${p.slice(0, -extension.length)}.ts`
}

/** Forms a stable path relative to the repo for diagnostics and legacy matching. */
function repoPath({ repo, file }: {
  repo: string
  file: string
}): string {
  return toPosix(relative(repo, resolve(file)))
}

/** The module owning an absolute path, if one exists. */
function sourceModule({ src, absolute, names }: {
  src: string
  absolute: string
  names: ReadonlySet<string>
}): string | undefined {
  const parts = toPosix(relative(resolve(src), absolute)).split('/')
  if (parts.length > 1 && names.has(parts[0])) return parts[0]
  return undefined
}

/**
 * Checks src/ as a whole against S1-S6: ownership, import boundaries, cycles, Node built-ins, entry imports
 * and generated unions.
 */
export function checkSource({ src, modules, options = {} }: {
  src: string
  modules: ModuleInfo[]
  options?: CheckOptions
}): Violation[] {
  const out: Violation[] = []
  const repo = dirname(resolve(src))
  const { legacy } = activeExemptions({ ex: options.exemptions ?? {}, today: options.today })
  const names = new Set(modules.map(m => m.dir))

  // S1: every directory is a module; flat files are index.ts + modules.generated.ts only.
  for (const d of readdirSync(src, { withFileTypes: true })) {
    const path = repoPath({ repo, file: join(src, d.name) })
    if (d.isDirectory()) {
      if (!names.has(d.name) && !isLegacy(path + '/', legacy)) out.push({
        rule: 'S1',
        module: 'src',
        message: `${path}/ has no index.ts (unowned code)`,
      })
      continue
    }
    if (!['index.ts', 'modules.generated.ts'].includes(d.name) && !isLegacy(path, legacy))
      out.push({
        rule: 'S1',
        module: 'src',
        message: `${path}: only src/index.ts and src/modules.generated.ts may live directly in src/`,
      })
  }

  // S2 + S4 + graph for S3
  const graph = new Map<string, Set<string>>([...names].map(n => [n, new Set<string>()]))
  for (const file of walk({ dir: src, keep: isSourceFile })) {
    const owner = sourceModule({ src, absolute: resolve(file), names })
    const path = repoPath({ repo, file })
    const legacyFile = !owner && isLegacy(path, legacy)
    for (const edge of importsOf(file)) {
      if (isNodeBuiltin(edge.specifier) && owner !== 'adapters' && !legacyFile)
        out.push({
          rule: 'S4',
          module: owner ?? 'src',
          message: `${path} imports '${edge.specifier}'; Node built-ins belong in src/adapters/`,
        })
      if (!owner || !edge.target) continue
      const targetModule = sourceModule({ src, absolute: edge.target, names })
      if (targetModule === owner) continue
      if (stem(edge.target) === stem(resolve(src, 'modules.generated.ts'))) continue
      if (!targetModule) {
        // Imports outside src/ (such as generated client assets) do not cross a module boundary.
        if (toPosix(relative(resolve(src), edge.target)).startsWith('..')) continue
        out.push({
          rule: 'S2',
          module: owner,
          message: `${path} imports '${edge.specifier}', which is not owned by any module`,
        })
        continue
      }
      graph.get(owner)!.add(targetModule)
      if (stem(edge.target) !== stem(resolve(src, targetModule, 'index.ts')))
        out.push({
          rule: 'S2',
          module: owner,
          message: `${path} imports '${edge.specifier}'; cross-module imports must target ../${targetModule}`,
        })
    }
  }

  // S3: strongly connected components of size > 1 are cycles (Tarjan).
  let index = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const on = new Set<string>()
  /** Tarjan's strongly-connected-components step from one module; reports each cycle it closes. */
  const strong = (v: string): void => {
    idx.set(v, index)
    low.set(v, index++)
    stack.push(v)
    on.add(v)
    for (const w of [...graph.get(v)!].sort()) {
      if (!idx.has(w)) {
        strong(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!))
    }
    if (low.get(v) === idx.get(v)) {
      const scc: string[] = []
      let w: string
      do {
        w = stack.pop()!
        on.delete(w)
        scc.push(w)
      } while (w !== v)
      if (scc.length > 1) {
        scc.sort()
        const edges = scc.flatMap(a => [...graph.get(a)!].filter(b => scc.includes(b)).sort().map(b => `${a} -> ${b}`))
        out.push({ rule: 'S3', module: scc[0], message: `import cycle among {${scc.join(', ')}}: ${edges.join(', ')}` })
      }
    }
  }
  for (const v of [...graph.keys()].sort()) if (!idx.has(v)) strong(v)

  // S5: the root entry only re-exports module surfaces.
  const entry = join(src, 'index.ts')
  if (existsSync(entry)) for (const edge of importsOf(entry)) {
    const ok = edge.target !== undefined && (
      [...names].some(n => stem(edge.target!) === stem(resolve(src, n, 'index.ts'))) ||
      stem(edge.target) === stem(resolve(src, 'modules.generated.ts')) ||
      isLegacy(jsToTs(toPosix(relative(repo, edge.target))), legacy) ||
      isLegacy(toPosix(relative(repo, edge.target)) + '.ts', legacy) ||
      isLegacy(toPosix(relative(repo, edge.target)), legacy))
    if (ok) continue
    const allowed = 'only ./<module> and ./modules.generated are allowed'
    out.push({
      rule: 'S5',
      module: 'src',
      message: `${repoPath({ repo, file: entry })} imports '${edge.specifier}'; ${allowed}`,
    })
  }

  // S6: generated unions are current.
  const generated = join(src, 'modules.generated.ts')
  const current = existsSync(generated) ? readFileSync(generated, 'utf8') : ''
  const codes = new Map(modules.map(m => [m.dir, findDiagnosticsCalls(m.root).flatMap(c => c.codes ?? [])]))
  const expected = renderModulesGenerated({ modules, codes, existing: current })
  if (current !== expected) {
    const before = parseModulesGenerated(current)
    const after = parseModulesGenerated(expected)
    const parts = [
      ['DomainName', generatedUnionChanges({ before: before.domains, after: after.domains })],
      ['DiagnosticCode', generatedUnionChanges({ before: before.codes, after: after.codes })],
    ].filter(([, d]) => d.length).map(([n, d]) => `${n} ${(d as string[]).join(' ')}`)
    const changes = parts.join('; ') || 'formatting only'
    out.push({
      rule: 'S6',
      module: 'src',
      message: `${repoPath({ repo, file: generated })} is stale (${changes}); run check:modules --write`,
    })
  }
  return out
}

/** Lists the added and removed names in a generated union. */
function generatedUnionChanges({ before, after }: {
  before: ReadonlySet<string>
  after: ReadonlySet<string>
}): string[] {
  const added = [...after].filter(value => !before.has(value)).map(value => `+${value}`)
  return added.concat([...before].filter(value => !after.has(value)).map(value => `-${value}`))
}

/** The literals declared in the generated module and diagnostic code unions. */
type GeneratedModuleLiterals = {
  domains: Set<string>
  codes: Set<string>
}

/** The string literals of the DomainName and DiagnosticCode unions, read from the AST. */
export function parseModulesGenerated(text: string): GeneratedModuleLiterals {
  const sf = ts.createSourceFile('modules.generated.ts', text, ts.ScriptTarget.Latest, true)
  const result = { domains: new Set<string>(), codes: new Set<string>() }
  for (const s of sf.statements) {
    if (!ts.isTypeAliasDeclaration(s)) continue
    let into: Set<string> | undefined
    if (s.name.text === 'DomainName') into = result.domains
    if (s.name.text === 'DiagnosticCode') into = result.codes
    if (into) visit(s.type, n => {
      if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) into.add(n.literal.text)
    })
  }
  return result
}

/** Renders string literals as a multi-line TypeScript union body, or `never` when empty. */
const union = (items: string[]): string => {
  if (!items.length) return '  never'
  // Keep the generated unions in stable groups of six, splitting wide groups for lint.
  const membersPerGroup = 6
  const maxLineLength = 120
  const lines: string[] = []
  for (let index = 0; index < items.length; index += membersPerGroup) {
    let line = ''
    for (const item of items.slice(index, index + membersPerGroup)) {
      const member = `| '${item}'`
      if (line && line.length + member.length + 1 > maxLineLength) {
        lines.push(line)
        line = ''
      }
      if (!line) line = ' '
      line += ` ${member}`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

/**
 * DomainName = module dirs. DiagnosticCode = codes already in the existing file (seeded from today's
 * raised codes; never dropped) ∪ every literal in a module's diagnostics tuple. Sorted, deterministic.
 */
export function renderModulesGenerated({ modules, codes, existing = '' }: {
  modules: ModuleInfo[]
  codes: Map<string, string[]>
  existing?: string
}): string {
  const domains = [...new Set(modules.map(m => m.dir))].sort()
  const all = [...new Set([...parseModulesGenerated(existing).codes, ...[...codes.values()].flat()])].sort()
  return `// GENERATED by scripts/check-modules.ts --write. Do not edit.
// DomainName: every directory src/<name>/ containing index.ts.
export type DomainName =
${union(domains)}
/**
 * Union of every literal passed to diagnostics(domain, [...]) across src/.
 * Seeded from the codes today's code raises; tests/compat/codes.test.ts pins this set.
 * A code may be raised by more than one module.
 */
export type DiagnosticCode =
${union(all)}
`
}

/** Runs every rule against a repo root (containing src/, tests/, tools/exemptions.json). */
export function runChecks({ root, write = false, today = todayUtc() }: {
  root: string
  write?: boolean
  today?: string
}): Violation[] {
  root = resolve(root)
  const src = join(root, 'src')
  const loaded = loadExemptions(join(root, 'tools', 'exemptions.json'))
  const options: CheckOptions = { today, exemptions: loaded.value }
  const modules = discoverModules(src, join(root, 'tests'))
  if (write) {
    const generated = join(src, 'modules.generated.ts')
    const current = existsSync(generated) ? readFileSync(generated, 'utf8') : ''
    const codes = new Map(modules.map(m => [m.dir, findDiagnosticsCalls(m.root).flatMap(c => c.codes ?? [])]))
    const next = renderModulesGenerated({ modules, codes, existing: current })
    if (next !== current) writeFileSync(generated, next)
  }
  const violations: Violation[] = []
  if (loaded.problem) violations.push({ rule: 'EX', module: 'src', message: loaded.problem })
  violations.push(
    ...activeExemptions({ ex: loaded.value, today }).violations,
    ...modules.flatMap(m => checkModule({ m, options })),
    ...checkSource({ src, modules, options }),
  )
  // Report paths relative to the root so output is stable wherever the script runs from.
  const prefix = toPosix(resolve(root)) + '/'
  const seen = new Set<string>()
  return violations.map(v => ({ ...v, message: v.message.split(prefix).join('') }))
    .filter(v => {
      const key = formatViolation(v)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** One report line for a violation: rule, module, message. */
export const formatViolation = (v: Violation): string => `${v.rule} ${v.module ?? 'src'}: ${v.message}`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const violations = runChecks({ root, write: process.argv.includes('--write') })
  for (const v of violations) console.log(formatViolation(v))
  process.exit(violations.length ? 1 : 0)
}
