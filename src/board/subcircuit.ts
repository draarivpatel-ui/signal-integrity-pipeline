import { fail } from "./diagnostics"

interface ScopeRecord {
  type: string
  source_group_id?: string
  subcircuit_id?: string
  parent_source_group_id?: string
}

/** Queries for subcircuit containment and the nearest common ancestor. */
export type SubcircuitTree = {
  within: (scope: { inner: unknown; outer: unknown }) => boolean
  common: (scopes: readonly unknown[]) => unknown
}

/** A scope's ancestors, innermost first and ending with the unscoped root. */
type ScopeChain = unknown[]

/** Walks from a scope to the unscoped root and rejects cyclic ownership. */
function scopeChain({
  parents,
  scope,
}: {
  parents: ReadonlyMap<unknown, unknown>
  scope: unknown
}): ScopeChain {
  const scopes: ScopeChain = []
  for (
    let current = scope;
    current !== undefined && current !== null;
    current = parents.get(current)
  ) {
    if (scopes.includes(current))
      fail("simulation_scope", "Cyclic subcircuit ownership")
    scopes.push(current)
  }
  return [...scopes, undefined]
}

/** Finds the nearest subcircuit containing every scope. */
function commonScope({
  parents,
  scopes,
}: {
  parents: ReadonlyMap<unknown, unknown>
  scopes: readonly unknown[]
}): unknown {
  if (!scopes.length) return undefined
  const chains = scopes.map((scope) => scopeChain({ parents, scope }))
  return chains[0].find((scope) =>
    chains.every((other) => other.includes(scope)),
  )
}

/**
 * Saved subcircuits nest: a board subcircuit can contain sibling subcircuits
 * (for example a processor and its DDR memory). A channel between siblings
 * belongs to their nearest common subcircuit. `undefined` is the unscoped root.
 */
export function subcircuitTree(
  records: readonly ScopeRecord[],
): SubcircuitTree {
  const sourceGroups = records.filter(
    (record) => record.type === "source_group",
  )
  const groups = new Map(
    sourceGroups.map((record) => [record.source_group_id, record]),
  )
  const parents = new Map<unknown, unknown>()
  for (const group of groups.values()) {
    if (!group.subcircuit_id || parents.has(group.subcircuit_id)) continue
    let parent: unknown
    let groupId = group.parent_source_group_id
    const visited = new Set<unknown>()
    while (groupId) {
      if (visited.has(groupId))
        fail("simulation_scope", "Cyclic source-group ownership")
      visited.add(groupId)
      const ancestor = groups.get(groupId)
      if (!ancestor) break
      if (
        ancestor.subcircuit_id &&
        ancestor.subcircuit_id !== group.subcircuit_id
      ) {
        parent = ancestor.subcircuit_id
        break
      }
      groupId = ancestor.parent_source_group_id
    }
    parents.set(group.subcircuit_id, parent)
  }
  return {
    within: ({ inner, outer }) =>
      scopeChain({ parents, scope: inner }).includes(outer ?? undefined),
    common: (scopes) => commonScope({ scopes, parents }),
  }
}
