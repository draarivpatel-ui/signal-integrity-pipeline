import { test } from "bun:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { relativeSpecifiers } from "../../scripts/relative-specifiers.mjs"

// House style: relative imports in TypeScript have no extension (`from './stages'`,
// `from '../board'`). scripts/fix-dist-imports.mjs adds `.js` back in dist/ for Node.
const root = join(import.meta.dirname, "..", "..")
/** Every .ts/.tsx file under this directory, recursively, skipping node_modules. */
const tsFiles = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory())
      return name === "node_modules" ? [] : tsFiles(rel)
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [rel] : []
  })

test("relative TypeScript imports carry no .js/.ts extension", () => {
  const bad = ["src", "tests", "scripts", "examples"]
    .flatMap(tsFiles)
    .flatMap((file) =>
      [
        ...relativeSpecifiers({
          source: readFileSync(join(root, file), "utf8"),
          checkExtensions: true,
        }),
      ].map(
        (specifier) =>
          `${relative(root, join(root, file))}: '${specifier.path}'`,
      ),
    )
  assert.deepEqual(bad, [])
})
