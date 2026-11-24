import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  type CrossSection,
  solveCrossSection,
  solveSectionCapacitance,
} from "../../../src/extraction"

test.failing(
  "layered two-plane stripline approaches the parallel-plate limit",
  () => {
    const widthMm = 6
    const section: CrossSection = {
      conductors: [{ id: "s", xMm: 0, zMm: 0.1, widthMm, thicknessMm: 0.035 }],
      planes: [{ zMm: 0 }, { zMm: 0.235 }],
      dielectrics: [
        { zMm: 0, thicknessMm: 0.04, er: 2.2, lossTangent: 0.009 },
        { zMm: 0.04, thicknessMm: 0.135, er: 5.1, lossTangent: 0.023 },
        { zMm: 0.175, thicknessMm: 0.06, er: 3.3, lossTangent: 0.035 },
      ],
    }
    // Each side is a series of parallel plates. The two sides add in parallel.
    const lowerElectricalMm = 0.04 / 2.2 + 0.06 / 5.1
    const upperElectricalMm = 0.04 / 5.1 + 0.06 / 3.3
    const vacuumPermittivityFPerM = 8.8541878128e-12
    const expectedCapacitanceFPerM =
      vacuumPermittivityFPerM *
      widthMm *
      (1 / lowerElectricalMm + 1 / upperElectricalMm)
    const expectedLossFPerM =
      vacuumPermittivityFPerM *
      widthMm *
      (((0.04 / 2.2) * 0.009 + (0.06 / 5.1) * 0.023) / lowerElectricalMm ** 2 +
        ((0.04 / 5.1) * 0.023 + (0.06 / 3.3) * 0.035) / upperElectricalMm ** 2)
    const result = solveCrossSection({ section })
    // The simple reference omits fringing at the two finite-width edges.
    assert.ok(Math.abs(result.C[0][0] / expectedCapacitanceFPerM - 1) < 0.04)
    assert.ok(
      Math.abs(result.dielectricLoss[0][0] / expectedLossFPerM - 1) < 0.04,
    )
    const step = 0.001
    const [plus, minus] = [step, -step].map((perturbation) =>
      solveSectionCapacitance({
        section: {
          ...section,
          dielectrics: section.dielectrics.map((layer) => ({
            ...layer,
            er: layer.er * (1 + perturbation * layer.lossTangent),
          })),
        },
      }),
    )
    const finiteDifferenceFPerM = (plus[0][0] - minus[0][0]) / (2 * step)
    assert.ok(
      Math.abs(finiteDifferenceFPerM / result.dielectricLoss[0][0] - 1) < 1e-6,
    )
  },
  30_000,
)
