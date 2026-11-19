// The import checks and dist rewrite look for relative strings after `from` or `import`.
const sourceExtensions = ['.js', '.ts', '.tsx']
const importKeywords = ['from', 'import']

/**
 * A relative import path and its source offsets.
 * @typedef {object} RelativeSpecifier
 * @property {string} path
 * @property {number} start
 * @property {number} end
 */

/**
 * Finds relative specifiers, with their offsets in the source text.
 * @param {{ source: string, checkExtensions?: boolean }} options
 * @returns {Generator<RelativeSpecifier, void, unknown>}
 */
export function* relativeSpecifiers({ source, checkExtensions = false }) {
  for (let start = 0; start < source.length; start++) {
    const keyword = importKeywords.find(candidate => source.startsWith(candidate, start))
    if (!keyword) continue
    let quoteAt = start + keyword.length

    while (source[quoteAt]?.trim() === '') quoteAt++
    if (source[quoteAt] === '(') quoteAt++
    while (source[quoteAt]?.trim() === '') quoteAt++
    const quote = source[quoteAt]
    if (quote !== "'" && quote !== '"') continue

    const pathStart = quoteAt + 1
    if (source[pathStart] !== '.') continue
    let end = pathStart + 1
    if (source[end] === '.') end++
    const hasSlash = source[end] === '/'
    if (hasSlash) {
      end++
      while (end < source.length && !["'", '"', '\n'].includes(source[end])) end++
    }
    const close = source[end]
    if (close !== "'" && close !== '"') continue

    const path = source.slice(pathStart, end)
    if (checkExtensions && (!hasSlash || !sourceExtensions.some(ext => path.endsWith(ext)))) continue
    if (!checkExtensions && close !== quote) continue

    yield { path, start: pathStart, end }
    start = end
  }
}
