import {
  asciiLowerCase,
  isDigit,
  isLineBreak,
  isSpace,
  lineEnd,
  splitWords,
} from "./text"

/** IBIS section 7 lumped package data; matrix order is exactly [Pin Numbers]. */
export interface PackageModel {
  name: string
  manufacturer: string
  oem: string
  description: string
  pins: string[]
  R: number[][]
  L: number[][]
  C: number[][]
}
interface Section {
  key: string
  argument: string
  lines: string[]
}

/** Scan just the package definition markers and global comment declarations. */
function* packageHeaders(text: string): IterableIterator<{
  key: string
  argument: string
  start: number
  end: number
}> {
  for (let start = 0; start < text.length; ) {
    let end = lineEnd(text, start)
    let open = start
    while (text[open] === " " || text[open] === "\t") open++
    if (text[open] === "[") {
      const header = text.slice(open + 1, end)
      const close = header.indexOf("]")
      if (close >= 0) {
        const key = asciiLowerCase(header.slice(0, close)).replaceAll("_", " ")
        if (
          key === "define package model" ||
          key === "end package model" ||
          key === "comment char"
        ) {
          let argument = open + close + 2
          while (text[argument] === " " || text[argument] === "\t") argument++
          // Marker arguments end at CR or LF, even when they contain a Unicode line separator.
          while (end < text.length && text[end] !== "\r" && text[end] !== "\n")
            end++
          yield { key, argument: text.slice(argument, end), start, end }
        }
      }
    }
    start = end + 1
  }
}

/** Read a comment marker followed by the IBIS "_char" suffix. */
function commentCharacter(argument: string): string | undefined {
  if (
    isLineBreak(argument[0]) ||
    argument.slice(1, 6).toLowerCase() !== "_char"
  )
    return undefined
  return argument[0]
}

/** Read a selected definition's section header and optional argument. */
function sectionHeader(
  line: string,
): Pick<Section, "key" | "argument"> | undefined {
  if (!line.startsWith("[")) return undefined
  const close = line.indexOf("]")
  if (close <= 1) return undefined
  const argument = line.slice(close + 1).trimStart()
  if (lineEnd(argument, 0) !== argument.length) return undefined
  const key = line.slice(1, close).toLowerCase().replaceAll("_", " ")
  return { key, argument }
}

/** Check that a count is spelled with one or more ASCII digits. */
function isUnsignedInteger(text: string): boolean {
  if (!text.length) return false
  for (const char of text) if (!isDigit(char)) return false
  return true
}

/** Read the named local definition without splitting a large vendor file into lines. */
export function parsePackageModel(text: string, name: string): PackageModel {
  let body: string | undefined
  let active: string | undefined
  let start = 0
  let comment = "|"
  let initialComment = "|"
  // Comment changes outside the selected definition still affect its contents.
  for (const header of packageHeaders(text)) {
    const { key, argument } = header
    if (key === "comment char") {
      const next = commentCharacter(argument)
      if (next === undefined || (argument.length > 6 && !isSpace(argument[6])))
        throw new Error(`${name}: invalid [Comment Char]`)
      comment = next
      continue
    }
    if (key === "define package model") {
      if (active) throw new Error(`${active}: missing [End Package Model]`)
      active = argument.split(comment)[0].trim()
      if (active === name && body !== undefined)
        throw new Error(`${name}: duplicate package definition`)
      if (active === name) initialComment = comment
      start = header.end
      continue
    }
    if (key === "end package model") {
      if (active === name && argument.split(comment)[0].trim())
        throw new Error(`${name}: unexpected data after [End Package Model]`)
      if (active === name) body = text.slice(start, header.start)
      active = undefined
    }
  }
  if (active === name) throw new Error(`${name}: missing [End Package Model]`)
  if (body === undefined)
    throw new Error(
      `${name}: [Define Package Model] missing in IBIS source; external .pkg lookup is unsupported; scalar fallback is forbidden`,
    )
  if (!name || name.length > 40)
    throw new Error(`${name}: invalid package name`)
  const sections: Section[] = []
  comment = initialComment
  const lines = body.split("\n")
  for (const [i, raw] of lines.entries()) {
    const lineText =
      i < lines.length - 1 && raw.endsWith("\r") ? raw.slice(0, -1) : raw
    const trimmed = lineText.trimStart()
    const commentHeader = "[comment char]"
    if (
      asciiLowerCase(trimmed.slice(0, commentHeader.length)).replaceAll(
        "_",
        " ",
      ) === commentHeader
    ) {
      const argument = trimmed.slice(commentHeader.length)
      const marker = argument.trimStart()
      const spacing = argument.length - marker.length
      let change = commentCharacter(marker)
      // The last whitespace can itself be the marker when it immediately precedes "_char".
      if (change === undefined && spacing > 0)
        change = commentCharacter(argument.slice(spacing - 1))
      if (change !== undefined) {
        comment = change
        continue
      }
    }
    const line = lineText.split(comment)[0].trim()
    if (!line) continue
    const header = sectionHeader(line)
    if (header?.key === "number of sections")
      throw new Error(
        `${name}: package sections are unsupported ([Number Of Sections]); scalar fallback is forbidden`,
      )
    if (header) {
      sections.push({ ...header, lines: [] })
      continue
    }
    if (!sections.length)
      throw new Error(`${name}: data before package metadata`)
    sections.at(-1)!.lines.push(line)
  }
  const metadata: Record<string, string> = {}
  const pins: string[] = []
  const matrices: Partial<Pick<PackageModel, "R" | "L" | "C">> = {}
  let count = 0
  let phase: "metadata" | "pins" | "data" | "end" = "metadata"
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const { key, argument, lines } = section
    if (
      ["manufacturer", "oem", "description", "number of pins"].includes(key)
    ) {
      if (phase !== "metadata" || key in metadata || lines.length)
        throw new Error(`${name}: invalid or duplicate [${key}]`)
      metadata[key] = argument
      if (key === "number of pins") {
        if (
          !isUnsignedInteger(argument) ||
          Number(argument) < 1 ||
          !Number.isSafeInteger(Number(argument))
        )
          throw new Error(`${name}: invalid [Number Of Pins]`)
        count = Number(argument)
        continue
      }
      let maxLength = 40
      if (key === "description") maxLength = 59
      if (!argument || argument.length > maxLength)
        throw new Error(`${name}: invalid [${key}]`)
      continue
    }
    if (key === "pin numbers") {
      if (phase !== "metadata" || !count || argument)
        throw new Error(`${name}: [Number Of Pins] must precede [Pin Numbers]`)
      for (const line of lines) {
        const pinKey = asciiLowerCase(line)
        if (
          [...line].some(isSpace) ||
          line.includes("=") ||
          line.includes("/") ||
          pinKey === "fork" ||
          pinKey === "endfork"
        )
          throw new Error(
            `${name}: package section syntax is unsupported in [Pin Numbers]`,
          )
        if (line.length > 5 || pins.includes(line))
          throw new Error(`${name}: invalid or duplicate package pin ${line}`)
        pins.push(line)
      }
      if (pins.length !== count)
        throw new Error(
          `${name}: package pin count ${pins.length} differs from [Number Of Pins] ${count}`,
        )
      phase = "pins"
      continue
    }
    if (key === "model data") {
      if (phase !== "pins" || argument || lines.length)
        throw new Error(`${name}: invalid [Model Data]`)
      phase = "data"
      continue
    }
    if (key === "end model data") {
      if (phase !== "data" || argument || lines.length)
        throw new Error(`${name}: invalid [End Model Data]`)
      phase = "end"
      continue
    }
    const fields: Record<string, "R" | "L" | "C" | undefined> = {
      "resistance matrix": "R",
      "inductance matrix": "L",
      "capacitance matrix": "C",
    }
    const field = fields[key]
    if (!field || phase !== "data" || matrices[field])
      throw new Error(`${name}: unexpected or duplicate [${key}]`)
    let end = i + 1
    while (
      end < sections.length &&
      ["bandwidth", "row"].includes(sections[end].key)
    )
      end++
    matrices[field] = parseMatrix({
      sections: sections.slice(i, end),
      pins,
      label: `${name} [${key}]`,
    })
    i = end - 1
  }
  for (const key of ["manufacturer", "oem", "description"])
    if (!(key in metadata))
      throw new Error(`${name}: required [${key.toUpperCase()}] missing`)
  if (phase !== "end") throw new Error(`${name}: missing [End Model Data]`)
  if (!matrices.L || !matrices.C)
    throw new Error(`${name}: required inductance/capacitance matrix missing`)
  return {
    name,
    manufacturer: metadata.manufacturer,
    oem: metadata.oem,
    description: metadata.description,
    pins,
    R: matrices.R ?? pins.map(() => pins.map(() => 0)),
    L: matrices.L,
    C: matrices.C,
  }
}

/** Require a finite standard IBIS number; suffix characters after the scale denote units. */
function matrixNumber(token: string, label: string): number {
  let end = 0
  if (token[end] === "+" || token[end] === "-") end++
  const start = end
  while (isDigit(token[end])) end++
  const hasWholeDigits = end > start
  if (token[end] === ".") {
    end++
    while (isDigit(token[end])) end++
  }
  if (!hasWholeDigits && !isDigit(token[end - 1]))
    throw new Error(`${label}: invalid numeric matrix value ${token}`)
  if (token[end] === "e" || token[end] === "E") {
    let exponent = end + 1
    if (token[exponent] === "+" || token[exponent] === "-") exponent++
    // An e without exponent digits can still be part of an alphabetic unit.
    if (isDigit(token[exponent])) {
      while (isDigit(token[exponent])) exponent++
      end = exponent
    }
  }
  const scales: Record<string, number> = {
    T: 1e12,
    G: 1e9,
    M: 1e6,
    k: 1e3,
    m: 1e-3,
    u: 1e-6,
    n: 1e-9,
    p: 1e-12,
    f: 1e-15,
  }
  const scale = scales[token[end]]
  const unit = scale === undefined ? end : end + 1
  for (let i = unit; i < token.length; i++) {
    const char = token[i]
    if ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z")) continue
    throw new Error(`${label}: invalid numeric matrix value ${token}`)
  }
  const coefficient = Number(token.slice(0, end)) * (scale ?? 1)
  if (!Number.isFinite(coefficient))
    throw new Error(`${label}: finite matrix value required: ${token}`)
  return coefficient
}

/** Expand upper-triangle storage, including the spec's optional circular band. */
function parseMatrix({
  sections,
  pins,
  label,
}: {
  sections: Section[]
  pins: string[]
  label: string
}): number[][] {
  const format = sections[0].argument.toLowerCase()
  if (
    !["full_matrix", "banded_matrix", "sparse_matrix"].includes(format) ||
    sections[0].lines.length
  )
    throw new Error(`${label}: invalid matrix format`)
  const banded = format === "banded_matrix"
  const hasBand = sections[1]?.key === "bandwidth"
  let width = pins.length - 1
  if (
    banded !== hasBand ||
    (hasBand &&
      (!isUnsignedInteger(sections[1].argument) || sections[1].lines.length))
  )
    throw new Error(
      `${label}: [Bandwidth] required only for Banded_matrix before rows`,
    )
  if (hasBand) width = Number(sections[1].argument)
  if (!Number.isSafeInteger(width) || width >= pins.length)
    throw new Error(`${label}: invalid bandwidth ${width}`)
  const rows = sections.slice(1 + Number(hasBand))
  if (
    rows.length !== pins.length ||
    rows.some((row, i) => row.key !== "row" || row.argument !== pins[i])
  )
    throw new Error(`${label}: row order must match [Pin Numbers] exactly`)
  const values = rows.map((row) => row.lines.flatMap(splitWords))
  const circular =
    banded && width > 0 && values.every((row) => row.length === width + 1)
  if (circular && width > Math.floor((pins.length - 1) / 2))
    throw new Error(`${label}: circular bandwidth creates redundant entries`)
  const matrix = pins.map(() => pins.map(() => 0))
  const indices = new Map(pins.map((pin, i) => [pin, i]))
  for (let i = 0; i < rows.length; i++) {
    if (format === "sparse_matrix") {
      const seen = new Set<number>()
      for (const line of rows[i].lines) {
        const tokens = splitWords(line)
        if (tokens.length !== 2)
          throw new Error(
            `${label} ${pins[i]}: each sparse (index, value) pair needs its own line`,
          )
        const j = indices.get(tokens[0])
        if (j === undefined)
          throw new Error(`${label}: unknown sparse column pin ${tokens[0]}`)
        if (j < i)
          throw new Error(
            `${label}: sparse entries must use the upper triangle in [Pin Numbers] order`,
          )
        if (seen.has(j))
          throw new Error(`${label}: duplicate sparse column ${tokens[0]}`)
        seen.add(j)
        matrix[i][j] = matrix[j][i] = matrixNumber(tokens[1], label)
      }
      continue
    }
    let count = width + 1
    if (!circular) count = Math.min(count, pins.length - i)
    if (values[i].length !== count)
      throw new Error(
        `${label} ${pins[i]}: expected ${count} entries, got ${values[i].length}; inconsistent bandwidth or truncated row`,
      )
    for (let k = 0; k < count; k++) {
      const j = (i + k) % pins.length
      matrix[i][j] = matrix[j][i] = matrixNumber(values[i][k], label)
    }
  }
  return matrix
}
