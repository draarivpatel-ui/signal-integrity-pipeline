/* eslint-disable local/max-file-lines -- The CLI keeps dictionary parsing and scoring together. */
/**
 * bun run check:vocabulary [--json] [--root <dir>]
 * Measures how many of the names declared in src/ are built only from words in tools/vocabulary.yaml.
 * It is not meant to reach 100%: it lists unknown words so a person decides "add to the dictionary" or "rename".
 *
 * Names counted (src/**\/*.ts and *.tsx, except *.generated.ts): function, method, class, interface,
 * type alias, enum and enum member names, variables (including destructured bindings), parameters,
 * type parameters, and properties/methods/accessors declared in interfaces, type literals and classes.
 * Skipped: imports, object-literal keys, string/number/computed names, 1-character names, and names
 * with no letters (`_`, `$`, `__`).
 *
 * Each distinct name counts once per module (the first folder under src/; files directly in src/ are
 * module "src"). A name declared by a top-level exported declaration anywhere in the module, or listed in
 * a local `export { name }`, weighs 2; every other name weighs 1. A name follows the dictionary when every
 * one of its words is known. Score = weight of following names / weight of all names × 100.
 * Exit 1 when the overall score is below the threshold or the dictionary is invalid; modules below
 * the threshold are only warnings.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

/** Removing a suffix usually appends no letters. */
const NO_SUFFIX_REPLACEMENT = ""
/** Keep the unknown-word summary short enough to scan. */
const DEFAULT_REPORT_LIMIT = 30

/** The parsed dictionary. Known words are domain ∪ general ∪ abbreviations; `avoid` words are never known. */
export interface Vocabulary {
  threshold: number
  /** Project concepts: word → meaning. */
  domain: Map<string, string>
  /** Everyday and programming words. */
  general: Set<string>
  /** Short forms: word → expansion. */
  abbreviations: Map<string, string>
  /** Words not to use: word → what to use instead. */
  avoid: Map<string, string>
}

/** A dictionary problem, with the 1-based line it was found on. */
export class VocabularyError extends Error {
  readonly line: number

  /** Builds the error message as `line N: message`. */
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`)
    this.name = "VocabularyError"
    this.line = line
  }
}

export const DEFAULT_THRESHOLD = 85
/** The four line terminators recognized by JavaScript. */
const LINE_BREAKS = ["\n", "\r", "\u2028", "\u2029"]

/** Checks for an ASCII lowercase letter. */
const isLowercase = (char: string): boolean => char >= "a" && char <= "z"
/** Checks for an ASCII uppercase letter. */
const isUppercase = (char: string): boolean => char >= "A" && char <= "Z"
/** Checks for an ASCII decimal digit. */
const isDigit = (char: string): boolean => char >= "0" && char <= "9"
/** Checks for JavaScript whitespace, including non-ASCII spaces. */
const isSpace = (char: string): boolean =>
  char.length === 1 && char.trim() === ""
/** Checks the dictionary's ASCII lowercase word format. */
function isWord(word: string): boolean {
  if (!isLowercase(word[0] ?? "")) return false
  for (const char of word)
    if (!isLowercase(char) && !isDigit(char)) return false
  return true
}

/** Checks for digits with an optional decimal point between two digit runs. */
function isDecimal(value: string): boolean {
  const [whole, fraction, ...extra] = value.split(".")
  return (
    extra.length === 0 &&
    whole.length > 0 &&
    Array.from(whole).every(isDigit) &&
    (fraction === undefined ||
      (fraction.length > 0 && Array.from(fraction).every(isDigit)))
  )
}
/** The ASCII vowels excluded when removing a doubled consonant. */
const VOWELS = "aeiou"

const SECTIONS = ["domain", "general", "abbreviations", "avoid"] as const
type Section = (typeof SECTIONS)[number]
/** Drops a trailing ` # comment` (a `#` preceded by whitespace) and surrounding whitespace. */
function stripComment(line: string): string {
  const lastBreak = Math.max(
    ...LINE_BREAKS.map((char) => line.lastIndexOf(char)),
  )
  for (let i = lastBreak + 1; i < line.length; i++) {
    if (line[i] === "#" && (i === 0 || isSpace(line[i - 1])))
      return line.slice(0, i).trim()
  }
  return line.trim()
}
/** A dictionary entry's key and optional value. */
type DictionaryEntry = [key: string, value: string | undefined]
/** Splits a dictionary line into its key and optional value. */
function readEntry(body: string): DictionaryEntry | undefined {
  const colon = body.indexOf(":")
  if (colon < 1) return undefined
  const key = body.slice(0, colon)
  if (Array.from(key).some(isSpace)) return undefined
  const rest = body.slice(colon + 1)
  if (rest && !isSpace(rest[0])) return undefined
  const value = rest.trimStart()
  if (LINE_BREAKS.some((char) => value.includes(char))) return undefined
  return [key, value || undefined]
}

/** Returns the words following the dash in a list line. */
function readList(body: string): string[] | undefined {
  if (body[0] !== "-" || !isSpace(body[1] ?? "")) return undefined
  const text = body.slice(1).trimStart()
  if (!text || LINE_BREAKS.some((char) => text.includes(char))) return undefined
  const words: string[] = []
  let word = ""
  for (const char of text) {
    if (!isSpace(char)) {
      word += char
      continue
    }
    if (word) {
      words.push(word)
      word = ""
    }
  }
  if (word) words.push(word)
  return words
}

/** Where a word first appeared in the dictionary. */
interface WordLocation {
  line: number
  section: Section
}

/** Records a well-formed dictionary word, rejecting duplicates across all sections. */
function claimWord({
  word,
  line,
  section,
  seen,
}: {
  word: string
  line: number
  section: Section
  seen: Map<string, WordLocation>
}): void {
  if (!isWord(word)) {
    const description = "lowercase letters and digits, starting with a letter"
    throw new VocabularyError(
      line,
      `"${word}" is not a valid word (${description})`,
    )
  }
  const before = seen.get(word)
  if (!before) {
    seen.set(word, { line, section })
    return
  }
  let where = `already listed in ${section}`
  if (before.section !== section)
    where = `already listed in ${before.section}; a word belongs to one section`
  throw new VocabularyError(line, `"${word}" is ${where} (line ${before.line})`)
}

/**
 * Parses the dictionary: a small YAML subset of `threshold: N`, the sections `domain:` and
 * `abbreviations:` / `avoid:` (indented `word: text` entries) and `general:` (indented `- word word`
 * lists). Comments (`#`) and blank lines are allowed. Anything else throws a VocabularyError naming the line.
 */
export function parseVocabulary(text: string): Vocabulary {
  const vocab: Vocabulary = {
    threshold: DEFAULT_THRESHOLD,
    domain: new Map(),
    general: new Set(),
    abbreviations: new Map(),
    avoid: new Map(),
  }
  const seen = new Map<string, WordLocation>()
  const sectionsSeen = new Set<string>()
  let section: Section | undefined
  const lines = text.split("\n")
  lines.forEach((piece, i) => {
    let raw = piece
    if (i < lines.length - 1 && piece.endsWith("\r")) raw = piece.slice(0, -1)
    const line = i + 1
    let indent = 0
    while (raw[indent] === " ") indent++
    if (raw[indent] === "\t")
      throw new VocabularyError(line, "use spaces, not tabs, for indentation")
    const body = stripComment(raw)
    if (!body) return
    const indented = isSpace(raw[0] ?? "")
    if (!indented) {
      const header = readEntry(body)
      if (!header || !Array.from(header[0]).every(isLowercase)) {
        const sectionNames = SECTIONS.join(", ")
        throw new VocabularyError(
          line,
          `expected "threshold: N" or a section header (${sectionNames}), got "${body}"`,
        )
      }
      const [key, value] = header
      if (sectionsSeen.has(key))
        throw new VocabularyError(line, `"${key}" appears twice`)
      sectionsSeen.add(key)
      if (key === "threshold") {
        if (value === undefined || !isDecimal(value) || Number(value) > 100) {
          throw new VocabularyError(
            line,
            `threshold must be a number from 0 to 100, got "${value ?? ""}"`,
          )
        }
        vocab.threshold = Number(value)
        section = undefined
        return
      }
      if (!(SECTIONS as readonly string[]).includes(key))
        throw new VocabularyError(
          line,
          `unknown key "${key}"; expected threshold, ${SECTIONS.join(", ")}`,
        )
      if (value !== undefined)
        throw new VocabularyError(
          line,
          `"${key}:" takes indented entries on the following lines, not a value`,
        )
      section = key as Section
      return
    }
    if (!section)
      throw new VocabularyError(
        line,
        `indented line is not inside a section (${SECTIONS.join(", ")})`,
      )
    if (section === "general") {
      const list = readList(body)
      if (!list)
        throw new VocabularyError(
          line,
          `general entries are lists of words: "- word word ...", got "${body}"`,
        )
      for (const word of list) {
        claimWord({ word, line, section, seen })
        vocab.general.add(word)
      }
      return
    }
    const entry = readEntry(body)
    let need = "the word to use instead"
    if (section === "domain") need = "a meaning"
    if (section === "abbreviations") need = "its expansion"
    if (!entry)
      throw new VocabularyError(
        line,
        `${section} entries look like "word: ${need}", got "${body}"`,
      )
    const [word, value] = entry
    claimWord({ word, line, section, seen })
    if (!value)
      throw new VocabularyError(line, `"${word}" in ${section} needs ${need}`)
    vocab[section].set(word, value)
  })
  return vocab
}

/**
 * True when the word is allowed: one of its candidates is in domain, general or abbreviations, and it is
 * not itself avoided.
 */
export function isKnown(word: string, vocab: Vocabulary): boolean {
  if (vocab.avoid.has(word)) return false
  return candidates(word).some(
    (c) =>
      vocab.domain.has(c) || vocab.general.has(c) || vocab.abbreviations.has(c),
  )
}

/** The replacement the dictionary suggests for an unknown word: its own `avoid` entry, else the first candidate's. */
export function avoidHint(word: string, vocab: Vocabulary): string | undefined {
  const hit = candidates(word).find((c) => vocab.avoid.has(c))
  return hit === undefined ? undefined : vocab.avoid.get(hit)
}

/** Removes `suffix` from the word and appends `add`, when the word ends with it and a letter stays. */
function strip({
  word,
  suffix,
  replacement: add = NO_SUFFIX_REPLACEMENT,
}: {
  word: string
  suffix: string
  replacement?: string
}): string[] {
  if (word.length <= suffix.length || !word.endsWith(suffix)) return []
  return [word.slice(0, -suffix.length) + add]
}

/** Plural stems: -ies → -y, -es → '', -s → '' (not after "ss"). */
function pluralStems(word: string): string[] {
  const stems = [
    ...strip({ word, suffix: "ies", replacement: "y" }),
    ...strip({ word, suffix: "es" }),
  ]
  if (!word.endsWith("ss")) stems.push(...strip({ word, suffix: "s" }))
  return stems
}

/** Verb and adverb stems: -ed / -ing / -er → '' and → -e, undoing a doubled final consonant; -ly → ''. */
function formStems(word: string): string[] {
  const out: string[] = []
  for (const suffix of ["ed", "ing", "er"])
    for (const stem of strip({ word, suffix })) {
      out.push(stem, stem + "e")
      const last = stem.at(-1) ?? ""
      if (stem.length >= 3 && last === stem.at(-2) && !VOWELS.includes(last))
        out.push(stem.slice(0, -1))
    }
  return [...out, ...strip({ word, suffix: "ly" })]
}

/**
 * Normalised forms of a word; the word is known when ANY of them is in the dictionary, so extra
 * forms are harmless. In order, deduplicated:
 *   the word itself
 *   -ies → -y            properties → property
 *   -es  → ''            boxes → box
 *   -s   → ''            values → value        (not after "ss": class stays class)
 *   -ed  → '' and -e     added → add, used → use
 *   -ing → '' and -e     reading → read, using → use
 *   -er  → '' and -e     builder → build, writer → write
 *   a doubled final consonant before -ed / -ing / -er is undone too: stopped → stop, running → run, getter → get
 *   -ly  → ''            strictly → strict
 *   the -ed/-ing/-er/-ly forms of each plural stem: builders → builder → build
 * Each rule keeps at least one letter.
 */
export function candidates(word: string): string[] {
  const plural = pluralStems(word)
  return [
    ...new Set([
      word,
      ...plural,
      ...formStems(word),
      ...plural.flatMap(formStems),
    ]),
  ]
}

/** Splits an identifier on casing, digit and separator boundaries. IBISModel becomes ibis, model. */
export function splitWords(name: string): string[] {
  const words: string[] = []
  let start = 0
  while (start < name.length) {
    let end = start
    while (isUppercase(name[end] ?? "")) end++
    if (isLowercase(name[end] ?? "") && end - start > 1) {
      end--
    } else {
      while (isLowercase(name[end] ?? "")) end++
    }
    if (end === start) {
      start++
      continue
    }
    words.push(name.slice(start, end).toLowerCase())
    start = end
  }
  return words
}

/** One declared name in a file, and whether a top-level export declares it. */
export interface CollectedName {
  name: string
  exported: boolean
}

/** The identifier text of a declaration name, or undefined for string, number and computed names. */
function nameText(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined
  if (ts.isIdentifier(name)) return name.text
  if (ts.isPrivateIdentifier(name)) return name.text.slice(1)
  return undefined
}

/** Every identifier a binding pattern declares, at any depth. */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((e) =>
    ts.isOmittedExpression(e) ? [] : bindingNames(e.name),
  )
}

/** True when a statement carries the `export` modifier. */
function hasExport(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
}

/** The text of an exported declaration name. */
type ExportedName = ts.Identifier["text"]

/** Names that the file's top-level statements export: `export <declaration>` and local `export { name }` lists. */
function exportedNames(sf: ts.SourceFile): Set<ExportedName> {
  const out = new Set<ExportedName>()
  for (const s of sf.statements) {
    if (
      ts.isExportDeclaration(s) &&
      !s.moduleSpecifier &&
      s.exportClause &&
      ts.isNamedExports(s.exportClause)
    ) {
      for (const e of s.exportClause.elements)
        out.add((e.propertyName ?? e.name).text)
      continue
    }
    if (!hasExport(s)) continue
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        for (const name of bindingNames(d.name)) out.add(name)
      }
      continue
    }
    if (
      ts.isFunctionDeclaration(s) ||
      ts.isClassDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      ts.isEnumDeclaration(s) ||
      ts.isModuleDeclaration(s)
    ) {
      const n = nameText(s.name)
      if (n !== undefined) out.add(n)
    }
  }
  return out
}

/** True for members that belong to a class, interface or type literal (not to an object literal). */
const declaredMember = (node: ts.Node): boolean =>
  ts.isClassLike(node.parent) ||
  ts.isInterfaceDeclaration(node.parent) ||
  ts.isTypeLiteralNode(node.parent)

/** The name a node declares, when it is one of the counted kinds of declaration. */
function declaredName(n: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isClassDeclaration(n) ||
    ts.isClassExpression(n) ||
    ts.isInterfaceDeclaration(n) ||
    ts.isTypeAliasDeclaration(n) ||
    ts.isEnumDeclaration(n) ||
    ts.isEnumMember(n) ||
    ts.isTypeParameterDeclaration(n) ||
    ts.isModuleDeclaration(n)
  )
    return nameText(n.name)
  if (
    ts.isVariableDeclaration(n) ||
    ts.isParameter(n) ||
    ts.isBindingElement(n)
  ) {
    if (ts.isIdentifier(n.name)) return n.name.text
    return undefined
  }
  if (
    (ts.isPropertySignature(n) ||
      ts.isMethodSignature(n) ||
      ts.isPropertyDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n)) &&
    declaredMember(n)
  )
    return nameText(n.name)
  return undefined
}

/** True for names that are never counted: one character, `this`, or no letters at all. */
const skipped = (name: string): boolean =>
  name.length < 2 || name === "this" || splitWords(name).length === 0

/** Records each declaration once, then visits its children. */
function collectDeclaredNames({
  node,
  exported,
  found,
}: {
  node: ts.Node
  exported: ReadonlySet<ExportedName>
  found: Map<string, CollectedName>
}): void {
  const name = declaredName(node)
  if (name !== undefined && !skipped(name) && !found.has(name)) {
    found.set(name, { name, exported: exported.has(name) })
  }
  ts.forEachChild(node, (child) =>
    collectDeclaredNames({ node: child, exported, found }),
  )
}

/** The distinct names a file declares (see the header for what counts), in first-seen order. */
export function collectNames({
  file,
  text,
}: {
  file: string
  text: string
}): CollectedName[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const exported = exportedNames(sf)
  const found = new Map<string, CollectedName>()
  collectDeclaredNames({ node: sf, exported, found })
  return [...found.values()]
}

/** A name as scored: the module it is declared in, and whether that module exports it. */
export interface NameEntry {
  module: string
  name: string
  exported: boolean
}
export interface ModuleScore {
  module: string
  score: number
  names: number
  belowTarget: boolean
}
export interface UnknownWord {
  word: string
  /** Distinct counted names (across all modules) that contain the word. */
  names: number
  examples: string[]
  /** The word to use instead, when the dictionary lists this word under `avoid`. */
  avoid?: string
}
export interface Report {
  threshold: number
  score: number
  names: number
  pass: boolean
  modules: ModuleScore[]
  /** How many distinct unknown words there are in total; `unknown` shows the most used. */
  unknownWords: number
  unknown: UnknownWord[]
}

/** Percentage of weight that follows; 100 when there is nothing to score. */
const percent = (good: number, all: number): number =>
  all === 0 ? 100 : (good / all) * 100

/**
 * Scores names against the dictionary. Entries are deduplicated per module (exported if any copy is).
 * Unknown words are ranked by how many distinct names contain them (desc), then alphabetically;
 * examples are the shortest such names, then alphabetical.
 */
export function scoreNames({
  entries,
  vocab,
  limit = DEFAULT_REPORT_LIMIT,
}: {
  entries: readonly NameEntry[]
  vocab: Vocabulary
  limit?: number
}): Report {
  const byModule = new Map<string, Map<string, boolean>>()
  for (const e of entries) {
    const names = byModule.get(e.module) ?? new Map<string, boolean>()
    byModule.set(e.module, names)
    names.set(e.name, (names.get(e.name) ?? false) || e.exported)
  }
  const unknownNames = new Map<string, Set<string>>()
  const known = new Map<string, boolean>()
  /** True when every word of the name is known; records the unknown words it contains. */
  const follows = (name: string): boolean => {
    let ok = true
    for (const word of splitWords(name)) {
      if (!known.has(word)) known.set(word, isKnown(word, vocab))
      if (known.get(word)) continue
      ok = false
      const set = unknownNames.get(word) ?? new Set<string>()
      unknownNames.set(word, set.add(name))
    }
    return ok
  }
  let good = 0
  let all = 0
  let count = 0
  const modules: ModuleScore[] = []
  for (const module of [...byModule.keys()].sort()) {
    let moduleGood = 0
    let moduleAll = 0
    for (const [name, exported] of byModule.get(module)!) {
      const weight = exported ? 2 : 1
      moduleAll += weight
      if (follows(name)) moduleGood += weight
    }
    const score = percent(moduleGood, moduleAll)
    modules.push({
      module,
      score,
      names: byModule.get(module)!.size,
      belowTarget: score < vocab.threshold,
    })
    good += moduleGood
    all += moduleAll
    count += byModule.get(module)!.size
  }
  const ranked = [...unknownNames].sort(
    ([a, x], [b, y]) => y.size - x.size || (a < b ? -1 : a > b ? 1 : 0),
  )
  const unknown = ranked.slice(0, limit).map(([word, names]): UnknownWord => {
    const examples = [...names]
      .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, 3)
    const hint = avoidHint(word, vocab)
    const entry: UnknownWord = { word, names: names.size, examples }
    if (hint !== undefined) entry.avoid = hint
    return entry
  })
  const score = percent(good, all)
  return {
    threshold: vocab.threshold,
    score,
    names: count,
    pass: score >= vocab.threshold,
    modules,
    unknownWords: ranked.length,
    unknown,
  }
}

/** Normalizes a native path to forward slashes. */
const toPosix = (p: string): string => p.split(sep).join("/")

/** Every .ts/.tsx file under a directory, sorted, without generated files. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => {
      const path = join(dir, d.name)
      if (d.isDirectory()) return sourceFiles(path)
      const extension = [".ts", ".tsx"].find((ext) => d.name.endsWith(ext))
      if (!extension || d.name.endsWith(`.generated${extension}`)) return []
      return [path]
    })
    .sort()
}

/** The module a file belongs to: the first folder under src/, or "src" for files directly in src/. */
export function moduleOf(src: string, file: string): string {
  const parts = toPosix(relative(src, file)).split("/")
  return parts.length > 1 ? parts[0] : "src"
}

/** The dictionary path inside a repo root. */
export const vocabularyPath = (root: string): string =>
  join(root, "tools", "vocabulary.yaml")

/** Reads and parses tools/vocabulary.yaml; errors name the file and line. */
export function loadVocabulary(root: string): Vocabulary {
  const path = vocabularyPath(root)
  if (!existsSync(path))
    throw new Error(
      `${toPosix(relative(root, path))}: dictionary file not found`,
    )
  try {
    return parseVocabulary(readFileSync(path, "utf8"))
  } catch (e) {
    throw new Error(`${toPosix(relative(root, path))}: ${(e as Error).message}`)
  }
}

/** Collects every counted name under <root>/src and scores it against <root>/tools/vocabulary.yaml. */
export function scoreProject({
  root,
  limit = DEFAULT_REPORT_LIMIT,
}: {
  root: string
  limit?: number
}): Report {
  root = resolve(root)
  const vocab = loadVocabulary(root)
  const src = join(root, "src")
  const entries = sourceFiles(src).flatMap((file) =>
    collectNames({ file, text: readFileSync(file, "utf8") }).map((n) => ({
      module: moduleOf(src, file),
      ...n,
    })),
  )
  return scoreNames({ entries, vocab, limit })
}

/** The human-readable report. */
export function formatReport(report: Report): string {
  /** A count with thousands separators. */
  const n = (x: number): string => x.toLocaleString("en-US")
  const mark = report.pass ? "✓" : "✗"
  const out = [
    `Vocabulary: ${report.score.toFixed(
      1,
    )}% of ${n(report.names)} names follow the dictionary (target ${report.threshold}%) ${mark}`,
  ]
  const width = Math.max(12, ...report.modules.map((m) => m.module.length + 1))
  for (const m of report.modules) {
    const line = `  ${m.module.padEnd(width)} ${`${m.score.toFixed(1)}%`.padStart(6)}  (${n(m.names)} names)`
    out.push(m.belowTarget ? `${line}  below target` : line)
  }
  if (report.unknown.length) {
    out.push(
      report.unknownWords > report.unknown.length
        ? `Unknown words (most used first; ${report.unknown.length} of ${n(report.unknownWords)}):`
        : "Unknown words (most used first):",
    )
    const wordWidth = Math.max(
      10,
      ...report.unknown.map((u) => u.word.length + 1),
    )
    for (const u of report.unknown) {
      const detail =
        u.avoid === undefined
          ? `e.g. ${u.examples.join(", ")}`
          : `avoid: use "${u.avoid}"`
      let label = "names"
      if (u.names === 1) label = "name "
      const word = u.word.padEnd(wordWidth)
      const count = String(u.names).padStart("100".length)
      out.push(`  ${word} ${count} ${label}   ${detail}`)
    }
  }
  return out.join("\n")
}

/** Command-line options for reporting vocabulary coverage. */
type VocabularyArgs = {
  json: boolean
  root: string
}

/** Parses `[--json] [--root <dir>]`; throws on anything else. */
export function parseArgs({
  args,
  defaultRoot,
}: {
  args: readonly string[]
  defaultRoot: string
}): VocabularyArgs {
  let json = false
  let root = defaultRoot
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true
    else if (args[i] === "--root" && args[i + 1] !== undefined) root = args[++i]
    else
      throw new Error(
        `unknown argument "${args[i]}"; usage: check-vocabulary [--json] [--root <dir>]`,
      )
  }
  return { json, root }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
    const args = parseArgs({ args: process.argv.slice(2), defaultRoot })
    const report = scoreProject({ root: args.root })
    console.log(
      args.json ? JSON.stringify(report, null, 2) : formatReport(report),
    )
    process.exit(report.pass ? 0 : 1)
  } catch (e) {
    console.error(`check-vocabulary: ${(e as Error).message}`)
    process.exit(1)
  }
}
