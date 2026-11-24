import { sectionKernel } from "./cross-section-kernel"
import {
  sectionFactor,
  sectionReciprocity,
  solveBoundarySystem,
} from "./cross-section-matrix"
import { sectionPanels } from "./cross-section-mesh"
import { type SectionMeshInput, sectionEpsilon0 } from "./cross-section-types"
import { fail } from "./diagnostics"
import { type Matrix, symmetrize } from "./linalg"

/** Largest raw reciprocity residual allowed before requesting a finer mesh or wider domain. */
const MAX_RECIPROCITY_RESIDUAL = 0.015

/** Capacitance and dielectric loss matrices with mesh size and reciprocity error. */
interface SectionFieldResult {
  C: Matrix
  loss: Matrix
  panels: number
  residual: number
}

/** Solve potential and dielectric-transmission equations; differentiate the SAME field operator
 * for material loss. This is the electrostatic energy sensitivity, not an averaged loss tangent.
 */
export function sectionField(mesh: SectionMeshInput): SectionFieldResult {
  const { region, vacuum, includeDielectricLoss = true } = mesh
  const hasLoss =
    includeDielectricLoss &&
    !vacuum &&
    region.dielectrics.some((layer) => layer.lossTangent > 0)
  const panels = sectionPanels(mesh)
  const size = region.conductors.length
  const rightHandSides = panels.map((panel) =>
    Array.from({ length: size }, (_, j) => Number(panel.group === j)),
  )
  const fields: Float64Array[] = []
  const matrix = panels.map((a, i) => {
    const row = Float64Array.from(panels, (b) =>
      sectionKernel({ a, b, height: region.height }),
    )
    if (a.group >= 0) return row
    if (hasLoss) fields[i] = row.slice()
    for (let j = 0; j < panels.length; j++)
      row[j] = Number(i === j) - a.contrast * a.length * row[j]
    return row
  })
  const factors = sectionFactor(matrix)
  const charge = solveBoundarySystem({ factors, rightHandSides })
  let lossCharge: Matrix = []
  if (hasLoss) {
    const sensitivityRightHandSides = panels.map((panel, i) => {
      if (panel.group >= 0) return Array<number>(size).fill(0)
      return Array.from({ length: size }, (_, j) => {
        const fieldCharge = charge.reduce(
          (sum, row, k) => sum + fields[i][k] * row[j],
          0,
        )
        return panel.derivative * panel.length * fieldCharge
      })
    })
    lossCharge = solveBoundarySystem({
      factors,
      rightHandSides: sensitivityRightHandSides,
    })
  }
  const C: Matrix = Array.from({ length: size }, () => Array(size).fill(0))
  const loss = C.map((row) => [...row])
  for (const [k, panel] of panels.entries()) {
    if (panel.group < 0) continue
    for (let j = 0; j < size; j++) {
      C[panel.group][j] += sectionEpsilon0 * panel.er * charge[k][j]
      if (!hasLoss) continue
      loss[panel.group][j] +=
        sectionEpsilon0 *
        panel.er *
        (lossCharge[k][j] + panel.tangent * charge[k][j])
    }
  }
  const residual = Math.max(sectionReciprocity(C), sectionReciprocity(loss))
  if (!Number.isFinite(residual) || residual > MAX_RECIPROCITY_RESIDUAL) {
    fail(
      "reciprocity",
      `Cross-section raw reciprocity ${residual}; refine panels or interface extent`,
    )
  }
  return {
    C: symmetrize(C),
    loss: symmetrize(loss),
    panels: panels.length,
    residual,
  }
}
