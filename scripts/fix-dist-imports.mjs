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
  let output = ''
  let copied = 0
  for (let start = source.indexOf(prefix); start !== -1; start = source.indexOf(prefix, start + 1)) {
    const quote = start + prefix.length
    if (source[quote] !== "'" && source[quote] !== '"') continue
    if (!source.startsWith('./', quote + 1)) continue
    const pathStart = quote + 3
    let pathEnd = pathStart
    while (pathEnd < source.length && source[pathEnd] !== "'" && source[pathEnd] !== '"') pathEnd++
    if (pathEnd - pathStart < 4 || !source.startsWith('.ts', pathEnd - 3)) continue
    if (source[pathEnd + 1] !== ',') continue
    let argument = pathEnd + 2
    while (source[argument]?.trim() === '') argument++
    if (!source.startsWith(tail, argument)) continue

    output += `${source.slice(copied, pathEnd - 3)}.js`
    copied = pathEnd
    start = argument + tail.length - 1
  }
  return `${output}${source.slice(copied)}`
}

const completeExtensions = ['.js', '.cjs', '.mjs', '.json', '.css', '.svg', '.txt']

/** Adds the extension or directory index needed by Node's ESM loader. */
function fixRelativeSpecifiers(source, file) {
  let output = ''
  let copied = 0
  for (const { path, start, end } of relativeSpecifiers(source)) {
    if (completeExtensions.some(ext => path.endsWith(ext))) continue
    const absolute = resolve(dirname(file), path)
    const jsPath = `${path}.js`
    let full = jsPath
    if (!existsSync(`${absolute}.js`)) {
      if (!existsSync(join(absolute, 'index.js'))) throw new Error(`${file}: cannot resolve '${path}'`)
      const separator = path.endsWith('/') ? '' : '/'
      full = `${path}${separator}index.js`
    }
    output += `${source.slice(copied, start)}${full}`
    copied = end
  }
  return `${output}${source.slice(copied)}`
}

for (const file of walk('dist').filter(path => path.endsWith('.js') || path.endsWith('.d.ts'))) {
  const src = readFileSync(file, 'utf8')
  const out = fixTypeScriptUrls(fixRelativeSpecifiers(src, file))
  if (out !== src) writeFileSync(file, out)
}
