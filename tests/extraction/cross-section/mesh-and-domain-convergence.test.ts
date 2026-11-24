import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  type CrossSectionResult,
  solveCrossSection,
} from "../../../src/extraction"
import { sectionFixture } from "../../fixtures/cross-section"

/** Relative coefficient error, including mutual coefficients rather than just a diagonal norm. */
function error({
  actual,
  expected,
}: {
  actual: number
  expected: number
}): number {
  return Math.abs(actual / expected - 1)
}

/** Compare material and vacuum capacitance, inductance and energy loss under mesh/domain changes. */
function change({
  a,
  b,
}: {
  a: CrossSectionResult
  b: CrossSectionResult
}): number {
  let largest = 0
  for (const key of ["C", "C0", "L", "dielectricLoss"] as const) {
    for (let i = 0; i < a.C.length; i++) {
      for (let j = 0; j < a.C.length; j++) {
        largest = Math.max(
          largest,
          error({ actual: a[key][i][j], expected: b[key][i][j] }),
        )
      }
    }
  }
  return largest
}

test("mesh and interface extent converge", () => {
  const fixture = sectionFixture({ kind: "microstrip", count: 2 })
  const base = solveCrossSection({ section: fixture })
  const fine = solveCrossSection({
    section: fixture,
    options: { panelsPerEdge: 16 },
  })
  const wide = solveCrossSection({
    section: fixture,
    options: { interfaceExtent: 48 },
  })
  const mesh = change({ a: base, b: fine })
  const domain = change({ a: base, b: wide })
  assert.ok(mesh < 0.01, `mesh coefficient change ${mesh}`)
  assert.ok(domain < 0.01, `domain coefficient change ${domain}`)
}, 30_000)
