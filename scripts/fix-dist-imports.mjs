// Source imports are extensionless (`from '../board'`). Node's ESM loader and NodeNext type
// resolution need full paths, so after `tsc` rewrite every relative specifier in dist/ to
// `./x.js` or `./x/index.js` (and the same in .d.ts files).
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { relativeSpecifiers } from './relative-specifiers.mjs'

const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
/** Point source-relative TypeScript URLs at their compiled JavaScript files. */
function fixTypeScriptUrls(source) {
  const prefix = 'new URL('
  const tail = 'import.meta.url)'
  const relativePrefix = './'
  const extension = '.ts'
  let output = ''
  let copied = 0
  for (let start = source.indexOf(prefix); start !== -1; start = source.indexOf(prefix, start + 1)) {
    const quote = start + prefix.length
    if (source[quote] !== "'" && source[quote] !== '"') continue
    if (!source.startsWith(relativePrefix, quote + 1)) continue
    const pathStart = quote + 1 + relativePrefix.length
    let pathEnd = pathStart
    while (pathEnd < source.length && source[pathEnd] !== "'" && source[pathEnd] !== '"') pathEnd++
    const extensionStart = pathEnd - extension.length
    if (extensionStart <= pathStart || !source.startsWith(extension, extensionStart)) continue
    if (source[pathEnd + 1] !== ',') continue
    let argument = pathEnd + 2
    while (source[argument]?.trim() === '') argument++
    if (!source.startsWith(tail, argument)) continue

    output += `${source.slice(copied, extensionStart)}.js`
    copied = pathEnd
    start = argument + tail.length - 1
  }
  return `${output}${source.slice(copied)}`
}

const completeExtensions = ['.js', '.cjs', '.mjs', '.json', '.css', '.svg', '.txt']

/**
 * Resolves an extensionless specifier to a compiled file or directory index.
 * @param {{ file: string, path: string }} options
 * @returns {string}
 */
function compiledRelativePath({ file, path }) {
  const absolute = resolve(dirname(file), path)
  if (existsSync(`${absolute}.js`)) return `${path}.js`
  if (!existsSync(join(absolute, 'index.js'))) throw new Error(`${file}: cannot resolve '${path}'`)
  if (path.endsWith('/')) return `${path}index.js`
  return `${path}/index.js`
}

/**
 * Adds the extension or directory index needed by Node's ESM loader.
 * @param {{ source: string, file: string }} options
 * @returns {string}
 */
function fixRelativeSpecifiers({ source, file }) {
  let output = ''
  let copied = 0
  for (const { path, start, end } of relativeSpecifiers({ source })) {
    if (completeExtensions.some(ext => path.endsWith(ext))) continue
    output += `${source.slice(copied, start)}${compiledRelativePath({ file, path })}`
    copied = end
  }
  return `${output}${source.slice(copied)}`
}

for (const file of walk('dist').filter(path => path.endsWith('.js') || path.endsWith('.d.ts'))) {
  const src = readFileSync(file, 'utf8')
  const out = fixTypeScriptUrls(fixRelativeSpecifiers({ source: src, file }))
  if (out !== src) writeFileSync(file, out)
}
