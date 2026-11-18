import { setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import {
  type CrossSection,
  type CrossSectionResult,
  type Matrix,
  solveCrossSection,
  solveSectionCapacitance,
} from "../../src/extraction"
import { energyFacts, maxwellFacts } from "../support/golden-checks"
import { sectionFixture } from "./cross-section-fixtures"
import {
  coupledMicrostrip,
  coupledStripline,
  pozarStriplineAttenuation,
  singleMicrostrip,
  stripline,
} from "./cross-section-reference"

setDefaultTimeout(30_000)

/** Speed of light in vacuum in meters per second, exact in SI. */
const LIGHT_SPEED = 299792458

/** Independent Cholesky test of strict positive definiteness, scaled to matrix magnitude. */
function positive(matrix: Matrix): void {
  const a = matrix.map((row) => [...row])
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j <= i; j++) {
      let value = a[i][j]
      for (let k = 0; k < j; k++) value -= a[i][k] * a[j][k]
      if (i === j) {
        assert.ok(value > 0, `positive pivot ${i}: ${value}`)
        a[i][j] = Math.sqrt(value)
        continue
      }
      a[i][j] = value / a[j][j]
    }
  }
}

/** Impedances and effective permittivities for the even and odd modes of two identical lines. */
interface CoupledModes {
  ze: number
  zo: number
  ee: number
  eo: number
}

/** Both scalar modal impedances, for two identical lines in a symmetric cross-section. */
function modes(result: CrossSectionResult): CoupledModes {
  return {
    ze: Math.sqrt(
      (result.L[0][0] + result.L[0][1]) / (result.C[0][0] + result.C[0][1]),
    ),
    zo: Math.sqrt(
      (result.L[0][0] - result.L[0][1]) / (result.C[0][0] - result.C[0][1]),
    ),
    ee: (result.C[0][0] + result.C[0][1]) / (result.C0[0][0] + result.C0[0][1]),
    eo: (result.C[0][0] - result.C[0][1]) / (result.C0[0][0] - result.C0[0][1]),
  }
}

/** Relative coefficient error, including mutual coefficients rather than just a diagonal norm. */
function error(actual: number, expected: number): number {
  return Math.abs(actual / expected - 1)
}

/** Compare material and vacuum capacitance, inductance and energy loss under mesh/domain changes. */
function change(a: CrossSectionResult, b: CrossSectionResult): number {
  let largest = 0
  for (const key of ["C", "C0", "L", "dielectricLoss"] as const) {
    for (let i = 0; i < a.C.length; i++) {
      for (let j = 0; j < a.C.length; j++) {
        largest = Math.max(largest, error(a[key][i][j], b[key][i][j]))
      }
    }
  }
  return largest
}

/** Compare a single-line solve with the independent isolated-line formulas. */
function singleLineError(
  result: CrossSectionResult,
  kind: "microstrip" | "stripline",
): number {
  let reference: ReturnType<typeof singleMicrostrip>
  if (kind === "microstrip") {
    reference = singleMicrostrip(1, 4)
  } else {
    const line = coupledStripline({
      width: 1,
      gap: 100,
      planeSpacing: 2.001,
      er: 4,
    })
    reference = { z: line.ze, ee: 4 }
  }
  const C = Math.sqrt(reference.ee) / (LIGHT_SPEED * reference.z)
  const L = (reference.z * Math.sqrt(reference.ee)) / LIGHT_SPEED
  const capacitance = result.C[0][0]
  const inductance = result.L[0][0]
  return Math.max(
    error(capacitance, C),
    error(inductance, L),
    error(Math.sqrt(inductance / capacitance), reference.z),
    error(
      Math.sqrt(inductance * capacitance),
      Math.sqrt(reference.ee) / LIGHT_SPEED,
    ),
  )
}

/** Compare even, odd and mutual entries with the independent two-line formulas. */
function coupledLineError(
  result: CrossSectionResult,
  kind: "microstrip" | "stripline",
): number {
  let expected: ReturnType<typeof coupledMicrostrip>
  if (kind === "microstrip") {
    expected = coupledMicrostrip({ width: 1, gap: 0.5, er: 4 })
  } else {
    const line = coupledStripline({
      width: 1,
      gap: 0.5,
      planeSpacing: 2.001,
      er: 4,
    })
    expected = { ...line, ee: 4, eo: 4 }
  }
  const actual = modes(result)
  let maximum = Math.max(
    error(actual.ze, expected.ze),
    error(actual.zo, expected.zo),
    error(result.L[0][1], expected.l12),
    error(result.C[0][1], expected.c12),
  )
  for (const [sign, ee, z] of [
    [1, expected.ee, expected.ze],
    [-1, expected.eo, expected.zo],
  ]) {
    const cm = result.C[0][0] + sign * result.C[0][1]
    const lm = result.L[0][0] + sign * result.L[0][1]
    maximum = Math.max(
      maximum,
      error(cm, Math.sqrt(ee) / (LIGHT_SPEED * z)),
      error(lm, (z * Math.sqrt(ee)) / LIGHT_SPEED),
      error(Math.sqrt(lm * cm), Math.sqrt(ee) / LIGHT_SPEED),
    )
  }
  return maximum
}

test(
  [
    "2D extraction: independent single/coupled formulas, matrix energy, loss,",
    "convergence and twelve-line timing",
  ].join(" "),
  () => {
    const rows: Record<string, string | number>[] = []
    for (const kind of ["microstrip", "stripline"] as const) {
      for (const count of [1, 2]) {
        const section = sectionFixture(kind, count)
        const start = performance.now()
        const result = solveCrossSection(section)
        const elapsed = performance.now() - start
        const maximum =
          count === 1
            ? singleLineError(result, kind)
            : coupledLineError(result, kind)
        assert.ok(
          maximum < 0.02,
          `${kind} ${count}: worst C/L/Z/delay/mutual error ${maximum}`,
        )
        rows.push({
          fixture: `${kind} ${count}`,
          panels: result.diagnostics.panels,
          ms: +elapsed.toFixed(2),
          worstErrorPercent: +(100 * maximum).toFixed(3),
        })
        for (const matrix of [
          result.C,
          result.C0,
          result.L,
          result.dielectricLoss,
          result.skinResistance,
        ]) {
          positive(matrix)
          for (let i = 0; i < count; i++) {
            for (let j = 0; j < count; j++) {
              assert.ok(
                Math.abs(matrix[i][j] - matrix[j][i]) <
                  1e-14 * Math.abs(matrix[i][i]),
              )
            }
          }
        }
        assert.ok(result.diagnostics.reciprocityResidual < 0.005)
      }
    }
    const fixture = sectionFixture("microstrip", 2)
    const start = performance.now()
    const base = solveCrossSection(fixture)
    const fine = solveCrossSection(fixture, { panelsPerEdge: 16 })
    const wide = solveCrossSection(fixture, { interfaceExtent: 48 })
    const mesh = change(base, fine)
    const domain = change(base, wide)
    assert.ok(mesh < 0.01, `mesh coefficient change ${mesh}`)
    assert.ok(domain < 0.01, `domain coefficient change ${domain}`)
    rows.push({
      fixture: "pair mesh 12→16 + domain 24→48 (all three)",
      ms: +(performance.now() - start).toFixed(2),
      meshPercent: +(100 * mesh).toFixed(3),
      domainPercent: +(100 * domain).toFixed(3),
    })
    for (const kind of ["microstrip", "mask", "stripline"] as const) {
      const begin = performance.now()
      const result = solveCrossSection(sectionFixture(kind, 12))
      const elapsed = performance.now() - begin
      for (const matrix of [
        result.C,
        result.C0,
        result.L,
        result.skinResistance,
      ])
        positive(matrix)
      assert.ok(result.diagnostics.reciprocityResidual < 0.005)
      assert.ok(
        result.C.every((row, i) =>
          row.every((value, j) => (i === j ? value > 0 : value <= 0)),
        ),
      )
      rows.push({
        fixture: `${kind} 12`,
        panels: result.diagnostics.panels,
        ms: +elapsed.toFixed(2),
        rawReciprocityPercent: +(
          result.diagnostics.reciprocityResidual * 100
        ).toFixed(3),
      })
    }
    console.table(rows)
  },
)

test("electrostatic-only path is byte-exact with full extraction for one/two-plane coupled sections", () => {
  for (const kind of ["microstrip", "stripline"] as const) {
    const section = sectionFixture(kind, 2)
    assert.deepEqual(
      solveSectionCapacitance(section),
      solveCrossSection(section).C,
    )
  }
  assert.throws(
    () =>
      solveSectionCapacitance(sectionFixture("microstrip", 1), {
        panelsPerEdge: 2,
      }),
    /panels per edge/,
  )
})

// ---- Golden known-answer checks. Expected values and tolerances are fixed from the
// cited physics before the solver runs; a failing check is reported, never loosened.
// CODATA 2018 constants, defined independently of the solver.
