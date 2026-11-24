import { type Matrix, symmetrize } from "../kernel"
import { evaluatePanelKernel } from "./cross-section-kernel"
import {
  calculateReciprocityResidual,
  factorBoundaryMatrix,
  solveBoundarySystem,
} from "./cross-section-matrix"
import { buildRegionPanels } from "./cross-section-mesh"
import {
  type RegionMeshInput,
  VACUUM_PERMITTIVITY_F_PER_M,
} from "./cross-section-types"
import { fail } from "./diagnostics"

/** Largest raw reciprocity residual allowed before requesting a finer mesh or wider domain. */
const MAX_RECIPROCITY_RESIDUAL = 0.015

/** Capacitance and dielectric loss matrices with mesh size and reciprocity error. */
interface RegionField {
  capacitanceFaradsPerMeter: Matrix
  loss: Matrix
  panelCount: number
  residual: number
}

/** Solve potential and dielectric-transmission equations; differentiate the SAME field operator
 * for material loss. This is the electrostatic energy sensitivity, not an averaged loss tangent.
 */
export function calculateRegionField(mesh: RegionMeshInput): RegionField {
  const { region, isVacuum, includeDielectricLoss = true } = mesh
  const hasLoss =
    includeDielectricLoss &&
    !isVacuum &&
    region.dielectricLayers.some((layer) => layer.lossTangent > 0)
  const panels = buildRegionPanels(mesh)
  const size = region.conductors.length
  const rightHandSides = panels.map((panel) =>
    Array.from({ length: size }, (_, j) => Number(panel.conductorIndex === j)),
  )
  const fields: Float64Array[] = []
  const matrix = panels.map((targetPanel, i) => {
    const row = Float64Array.from(panels, (sourcePanel) =>
      evaluatePanelKernel({
        targetPanel,
        sourcePanel,
        planeSpacingMm: region.planeSpacingMm,
      }),
    )
    if (targetPanel.conductorIndex >= 0) return row
    if (hasLoss) fields[i] = row.slice()
    for (let j = 0; j < panels.length; j++)
      row[j] =
        Number(i === j) -
        targetPanel.permittivityContrast * targetPanel.lengthMm * row[j]
    return row
  })
  const factors = factorBoundaryMatrix(matrix)
  const charge = solveBoundarySystem({ factors, rightHandSides })
  let lossCharge: Matrix = []
  if (hasLoss) {
    const sensitivityRightHandSides = panels.map((panel, i) => {
      if (panel.conductorIndex >= 0) return Array<number>(size).fill(0)
      return Array.from({ length: size }, (_, j) => {
        const fieldCharge = charge.reduce(
          (sum, row, k) => sum + fields[i][k] * row[j],
          0,
        )
        return panel.contrastLossDerivative * panel.lengthMm * fieldCharge
      })
    })
    lossCharge = solveBoundarySystem({
      factors,
      rightHandSides: sensitivityRightHandSides,
    })
  }
  const capacitanceFaradsPerMeter: Matrix = Array.from({ length: size }, () =>
    Array(size).fill(0),
  )
  const loss = capacitanceFaradsPerMeter.map((row) => [...row])
  for (const [k, panel] of panels.entries()) {
    if (panel.conductorIndex < 0) continue
    for (let j = 0; j < size; j++) {
      capacitanceFaradsPerMeter[panel.conductorIndex][j] +=
        VACUUM_PERMITTIVITY_F_PER_M * panel.relativePermittivity * charge[k][j]
      if (!hasLoss) continue
      loss[panel.conductorIndex][j] +=
        VACUUM_PERMITTIVITY_F_PER_M *
        panel.relativePermittivity *
        (lossCharge[k][j] + panel.lossTangent * charge[k][j])
    }
  }
  const residual = Math.max(
    calculateReciprocityResidual(capacitanceFaradsPerMeter),
    calculateReciprocityResidual(loss),
  )
  if (!Number.isFinite(residual) || residual > MAX_RECIPROCITY_RESIDUAL) {
    fail(
      "reciprocity",
      `Cross-section raw reciprocity ${residual}; refine panels or interface extent`,
    )
  }
  return {
    capacitanceFaradsPerMeter: symmetrize(capacitanceFaradsPerMeter),
    loss: symmetrize(loss),
    panelCount: panels.length,
    residual,
  }
}
