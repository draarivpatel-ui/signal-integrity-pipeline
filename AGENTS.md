# Rules for agents and contributors

This is the only agent rules file. Do not add CLAUDE.md, GEMINI.md, .cursorrules or similar; tests/tooling/docs.test.ts fails if one appears.

## Diagrams: Mermaid only (enforced by `tests/tooling/docs.test.ts`)

1. Every diagram in this repo is a fenced ```` ```mermaid ```` block inside Markdown: README, `docs/`, and PR descriptions alike.
   Never commit or upload diagram images (PNG/SVG/JPG renders, screenshots of diagrams).
2. Each diagram is one of exactly two concepts:
   - **Workflow:** `flowchart` (data or call flow: what happens, which module owns each step).
   - **State machine:** `stateDiagram-v2` (phases, transitions, terminal and failure states).
   Anything else (module tables, file maps, rule lists) is a Markdown table, not a diagram.
3. When code changes a workflow or a state machine (new stage, new module step, new failure path), update its diagram in the same PR.

## README contract (enforced by the same test)

`README.md` starts with these sections, in this order:
1. `## What is it?`
2. `## How to use it?`
3. `## General workflow`: contains at least one `flowchart` and one `stateDiagram-v2` block.

## Code

- Install dependencies with `pnpm install --frozen-lockfile`.
- `pnpm lint && pnpm check:modules && pnpm check:vocabulary && pnpm typecheck && pnpm test` must pass before a PR is ready.
- Relative imports have no extension: `from './stages'`, and `from '../board'` for another module (enforced by `tests/tooling/imports.test.ts`). The build adds `.js` back in `dist/`.
- Module rules, verification and migration notes: `docs/ARCHITECTURE.md`.
- Output must stay byte-identical unless the PR says otherwise: `tests/compat/` pins exports and error codes. Preserve artifact paths and hashes for any stages you add.

## Code style (tscircuit handbook: `tscircuit/handbook` `guides/code.md`, `guides/api-design.md`)

Clarity beats brevity. More lines are fine when they are easier to read.

### Functions
- **At most 2 parameters.** More inputs go in one named object: `fn({ circuit, rails, seed })`. This covers functions, methods, named arrows and constructors. Inline callbacks (`xs.map(x => …)`) are exempt.
- **Early returns and `continue`** instead of nested `if`/`else`. No value ternaries that hide a branch. Write the `if` out.
- **Top-level functions.** No nested closures or helpers defined inside other functions. The only exception is a factory whose job is to return a function.
- **No conditional spreads** (`...(x ? { a } : {})`). Build the object, then set the field in an `if`.

### Types
- **Named return types.** A function returning an object literal, tuple, nested array or a collection of id strings returns a named type with a one-line JSDoc:
  ```ts
  /** The two pins of a series resistor, capacitor or inductor, treated as wired together for a signal. */
  export type PassiveBridge = [pinA: SourcePortId, pinB: SourcePortId]
  export function passiveBridges(circuit: CircuitJson, excluded: ReadonlySet<SourcePortId>): PassiveBridge[]
  ```
- **Reuse existing types before inventing one.** Check, in this order: `circuit-json`, `circuit-json-to-connectivity-map`, then `@tscircuit/props` / `@tscircuit/core`.
  - Derive ids from records: `SourcePort['source_port_id']`, not `string`.
  - Use `PcbTrace`, `PcbTraceRoutePointWire | PcbTraceRoutePointVia`, `Point` and `LayerRef` instead of hand-written `Extract<…>` or `{ x: number; y: number }`.
  - Shared ids live in `src/board/ids.ts`.
- No enums (see Lint). No back-compat aliases or shims: rename the thing and update every caller.

### Expressions
- **No `!!`.** Write the comparison: `signal.driver_disabled === true`.
- **No regular expressions in source** (`src/`, `scripts/`, `site/`, `pages/`, `examples/`). Use `startsWith`, `includes`, `indexOf`, `slice` and `split(' ')`, a `for` loop over characters, or a small named helper like `isDigit(char)`. Tests may use a regex only inside an assertion (`assert.match(message, /…/)`).
- **Name magic numbers** as constants with a one-line reason (`const STARTUP_SETTLE_BITS = 16`).

### Reuse and size
- **Prefer existing libraries.** Net membership comes from `circuit-json-to-connectivity-map`, so don't write another connectivity walk. Build its map with `new ConnectivityMap(findConnectedNetworks(groups))`, not `addConnections`: in 0.0.35, `addConnections` can overwrite an existing net id.
- **Prefer deleting code to adding it.** No fallbacks, no "restore if missing" paths, no defensive checks that another layer already owns.
- Keep a PR to what its title says. Unrelated cleanups go in their own PR.

## Words

- Spell out terms the first time and in names: **unit interval** (one bit time, `1 / bit_rate_bps`), not "UI". Write **pseudo-random binary sequence (PRBS)** in titles and docs. The chart tick label `2 UI` is the only exception, because space is limited there.
- All times in Circuit JSON records are `_ms` numbers. Pipeline internals use seconds and say so in the name (`defaultDurationSeconds`).

## Tests

- Reproductions and fixtures are **TSX source rendered through core**, not hand-written Circuit JSON (`tests/support/signal-parts.tsx`, `signal-render.tsx`).
- Keep tests simple: one behaviour per `test()`, a short name saying what is checked, no clever helpers.
- For routed pipeline refactors that claim "no behaviour change", prove it before merge:
  - golden checks unchanged (27 pass, 2 TODO, 2 n/a; vendor waveform records identical);
  - the 40 ns two-trace replay byte-identical (deck SHA-256 and every sample);
  - for connectivity or topology changes, an equivalence run over every example and fixture, comparing results for every port as a seed.
- ngspice and golden runs are slow. Run one at a time on a machine.

## Pull requests

- **Small and focused, stacked.** One concept per PR, e.g. "add RouteSectionsSolver", not "pipeline changes". Dependency or package bumps get their own PR at the bottom of the stack. Use GitHub native stacks (`gh stack link`).
- **Specific titles.** Say what is added and where: `feat: check IBIS pin roles and references for channel endpoints`. Not `feat: read signals`. If a PR also updates packages, the title says so.
- **Descriptions are short and plain:**
  - what the PR adds and why;
  - what it's stacked on;
  - a `### New concepts` section for every idea a reviewer meets for the first time (e.g. CopperScope, the passive bridge), with 1–3 sentences on what it is, why it's needed and where it's used;
  - a line saying so when behaviour changes, e.g. internally connected pins now joining nets.
- Every layer of a stack must pass typecheck, lint, build and its own tests on its own.

## Private data (never commit)

- Vendor IBIS files (`*.ibs`) stay local in the gitignored `models/`. Only `examples/vendor-models.lock.json` (names and hashes) is committed.
- Real board Circuit JSON, board-derived decks, captures and extracted geometry stay local (`models/ddr3-board.json`, `.cache/`).
- The only approved paths for board-derived example files are `examples/level4-ddr3-write/` and `examples/ddr3-parts.tsx`.
- Check `git status` and the diff before every commit.

## Lint (`pnpm lint`, config in `eslint.config.mjs`, custom rules in `tools/eslint/rules.mjs`)

| Rule | What it means |
|---|---|
| One variable per declaration | `const a = 1, b = 2` is not allowed. Write each on its own line. |
| One statement per line | No `const a = 1; const b = 2` on one line. |
| At most 120 characters per line | Split long lines in TypeScript, TSX and MJS. Lines containing only a URL are exempt. |
| One member per line | Start each interface member, object type member and multiline object property on a separate line. |
| Every named function has JSDoc and a typed signature | Function declarations, methods and `const f = () => …` need a `/** … */` comment, a type on every parameter and a return type. Inline callbacks like `xs.map(x => x * 2)` are exempt. |
| No enums | Use a string-literal union (`type Mode = 'a' \| 'b'`) or an `as const` object. |
| TypeScript files over 500 lines warn | Split the file. If it is important to keep it whole, add `/* eslint-disable local/max-file-lines -- <reason> */` at the top. |
| One test file per source file | `tests/<module>/<name>.test.ts` tests `src/<module>/<name>.ts` (or `<name>/index.ts`). Many tests per file are fine. `tests/compat`, `tests/tooling` and `tests/support` test the package as a whole and are exempt. |

## Naming vocabulary (`pnpm check:vocabulary`, dictionary in `tools/vocabulary.yaml`)

Build names in `src/` from the words in `tools/vocabulary.yaml`. The checker splits every declared name into words (`foldProbeEye` → fold, probe, eye) and reports the share of names made only of dictionary words. It must stay at or above the file's `threshold` (85%). 100% is not the goal.

- Prefer a word already in the dictionary. If it lists two words for one idea, use the listed one; `avoid` names the word to use instead.
- Need a new concept? Add the word with a one-line plain-English meaning in the same PR as the code that uses it, so the reviewer sees the new word.
- List base forms only: plurals and verb forms are accepted automatically (`ids` → id, `selected` → select).
