import type { DomainName } from '../modules.generated'
import { fail } from './fail'

/** Output wire format: path -> UTF-8 body. Only ArtifactLedger.seal() creates one. */
export type FileMap = Record<string, string>

declare const pathBrand: unique symbol
/** A validated, normalized, relative POSIX path ('a/b.json'; no '', '.', '..', '\\', ':', NUL, leading '/'). */
export type ArtifactPath = string & { readonly [pathBrand]: true }

/** One file a module produced. The owner tag is how the ledger enforces single-writer. */
export interface Artifact {
  readonly owner: DomainName
  readonly path: ArtifactPath
  readonly body: string
}

/** Every domain operation that writes files returns its value plus the files; it never mutates a shared map. */
export interface Produced<T> {
  readonly value: T
  readonly artifacts: readonly Artifact[]
}

/**
 * A directory a module is allowed to write under, stamped with the owning module.
 * Modules build paths only through a scope; the pipeline hands scopes down
 * (e.g. simulation gets `experiments/<id>`, then records numerical convergence under that experiment).
 */
export interface ArtifactScope {
  readonly owner: DomainName
  readonly prefix: string
  /** Child scope for the same owner. Segments must be SafeId-shaped. */
  child(...segments: string[]): ArtifactScope
  /** Same prefix, transferred to another owner (only the pipeline does this). */
  handTo(owner: DomainName): ArtifactScope
  json(name: string, value: unknown): Artifact
  text(name: string, body: string): Artifact
}
/** Top-level scope (empty prefix) for one owner; every other scope is derived from it with child() or handTo(). */
export function rootScope(owner: DomainName): ArtifactScope {
  return scope({ owner, prefix: '' })
}

/** Validate and brand a relative POSIX path. */
export function artifactPath(raw: string): ArtifactPath {
  const segments = raw.split('/')
  const hasInvalidSegment = segments.some(segment => segment === '' || segment === '.' || segment === '..')
  // NUL is forbidden in a filesystem path.
  const nul = '\0'
  if (!raw || raw.startsWith('/') || raw.includes('\\') || raw.includes(nul) || hasInvalidSegment) {
    const requirements = "artifact paths must be relative POSIX paths without empty, '.' or '..' segments"
    fail('artifact_path', `${JSON.stringify(raw)}: ${requirements}`)
  }
  return raw as ArtifactPath
}

/** Today's jsonFile byte format. */
export const jsonBody = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'

/** Joins a file name onto its scope's prefix and validates the result. */
function scopePath({ prefix, name }: {
  prefix: string
  name: string
}): ArtifactPath {
  if (!prefix) return artifactPath(name)
  return artifactPath(`${prefix}/${name}`)
}

/** Builds the scope object; every artifact it creates is stamped with `owner` and has its path validated. */
function scope({ owner, prefix }: {
  owner: DomainName
  prefix: string
}): ArtifactScope {
  return {
    owner,
    prefix,
    child: (...segments) => scope({ owner, prefix: [prefix, ...segments].filter(Boolean).join('/') }),
    handTo: next => scope({ owner: next, prefix }),
    json: (name, value) => ({ owner, path: scopePath({ prefix, name }), body: jsonBody(value) }),
    text: (name, body) => ({ owner, path: scopePath({ prefix, name }), body }),
  }
}

/**
 * Immutable, append-only collection of artifacts. Owned by the pipeline module alone:
 * no other module holds a ledger, so there is exactly one writer of the output FileMap.
 * Tests: tests/kernel/index.test.ts (collision, sorted keys).
 */
export class ArtifactLedger {
  private constructor(private readonly entries: ReadonlyMap<ArtifactPath, Artifact>) {}
  /** The starting ledger with no artifacts; build up from here with add(). */
  static empty(): ArtifactLedger { return new ArtifactLedger(new Map()) }
  /** Fails 'artifact_collision' if any path is already present (even with an identical body). */
  add(artifacts: readonly Artifact[]): ArtifactLedger {
    const next = new Map(this.entries)
    for (const a of artifacts) {
      if (next.has(a.path)) {
        const prior = next.get(a.path)!
        fail('artifact_collision', `${a.path}: written by ${prior.owner} and again by ${a.owner}`,
          { subjects: [{ kind: 'artifact', id: a.path }] })
      }
      next.set(a.path, a)
    }
    return new ArtifactLedger(next)
  }
  /** True when some artifact has already been recorded at this path. */
  has(path: string): boolean { return this.entries.has(path as ArtifactPath) }
  /** Body of the artifact at this path, or undefined when nothing was written there. */
  get(path: string): string | undefined { return this.entries.get(path as ArtifactPath)?.body }
  /** Keys sorted by code point => byte-identical FileMap for identical inputs (determinism). */
  seal(): FileMap {
    const files: FileMap = Object.create(null)
    const paths = [...this.entries.keys()].sort()
    for (const path of paths) files[path] = this.entries.get(path)!.body
    return files
  }
}
