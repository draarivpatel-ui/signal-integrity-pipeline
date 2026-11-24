import { defaultCopperConductivitySm } from "../board"
import { DIELECTRIC_BOUNDARY_TOLERANCE_MM } from "./cross-section-mesh"
import type {
  CrossSection,
  CrossSectionDielectricLayer,
} from "./cross-section-types"
import { fail } from "./diagnostics"

/** Bound the dense conductor matrices assembled across all shielded regions. */
const MAX_CONDUCTORS = 512

/** Check conductor dimensions, clearance from planes and separation between rectangular signals. */
function validateConductors({ conductors, planes }: CrossSection): void {
  const ids = new Set(conductors.map((c) => c.conductorId))
  if (ids.size !== conductors.length || [...ids].some((id) => !id)) {
    fail(
      "cross_section_geometry",
      "Cross-section conductor IDs must be unique and nonempty",
    )
  }
  for (const c of conductors) {
    const conductivity = c.conductivitySm ?? defaultCopperConductivitySm
    const finite = [c.xMm, c.zMm, c.widthMm, c.thicknessMm, conductivity].every(
      Number.isFinite,
    )
    if (!finite || c.widthMm <= 0 || c.thicknessMm <= 0 || conductivity <= 0) {
      fail(
        "cross_section_geometry",
        "Finite positive conductor dimensions and conductivity required",
      )
    }
    if (planes.some((p) => p.zMm >= c.zMm && p.zMm <= c.zMm + c.thicknessMm)) {
      fail(
        "cross_section_geometry",
        "A conductor touches or crosses a reference plane",
      )
    }
  }
  for (const [i, a] of conductors.entries()) {
    for (const b of conductors.slice(i + 1)) {
      const horizontalOverlap =
        Math.abs(a.xMm - b.xMm) <= (a.widthMm + b.widthMm) / 2
      const verticalOverlap =
        a.zMm <= b.zMm + b.thicknessMm && b.zMm <= a.zMm + a.thicknessMm
      if (horizontalOverlap && verticalOverlap)
        fail("cross_section_geometry", "Conductor rectangles overlap or touch")
    }
  }
}

/** Check that dielectric slabs have physical properties and occupy distinct height intervals. */
function validateDielectrics(
  dielectricLayers: CrossSectionDielectricLayer[],
): void {
  for (const [i, a] of dielectricLayers.entries()) {
    const finite = [
      a.zMm,
      a.thicknessMm,
      a.relativePermittivity,
      a.lossTangent,
    ].every(Number.isFinite)
    if (
      !finite ||
      a.thicknessMm <= 0 ||
      a.relativePermittivity < 1 ||
      a.lossTangent < 0
    ) {
      fail(
        "cross_section_geometry",
        "Dielectric layers need positive thickness, relative permittivity >= 1 and nonnegative loss tangent",
      )
    }
    const overlaps = dielectricLayers.slice(i + 1).some((b) => {
      return (
        a.zMm < b.zMm + b.thicknessMm - DIELECTRIC_BOUNDARY_TOLERANCE_MM &&
        b.zMm < a.zMm + a.thicknessMm - DIELECTRIC_BOUNDARY_TOLERANCE_MM
      )
    })
    if (overlaps) fail("cross_section_geometry", "Dielectric layers overlap")
  }
}

/** Reject unsupported/degenerate geometry rather than changing copper or material boundaries. */
export function validateCrossSection(crossSection: CrossSection): void {
  if (!crossSection.conductors.length || !crossSection.planes.length) {
    fail(
      "cross_section_geometry",
      "A cross-section needs conductors and at least one solid reference plane",
    )
  }
  if (crossSection.conductors.length > MAX_CONDUCTORS) {
    fail(
      "mesh_panel_limit",
      `Cross-section exceeds the conductor limit of ${MAX_CONDUCTORS}`,
    )
  }
  validateConductors(crossSection)
  for (const [i, plane] of crossSection.planes.entries()) {
    const conductivity = plane.conductivitySm ?? defaultCopperConductivitySm
    const finite = [plane.zMm, conductivity].every(Number.isFinite)
    if (
      !finite ||
      conductivity <= 0 ||
      crossSection.planes.slice(i + 1).some((p) => p.zMm === plane.zMm)
    ) {
      fail(
        "cross_section_geometry",
        "Reference planes need unique finite heights and positive conductivity",
      )
    }
  }
  validateDielectrics(crossSection.dielectricLayers)
}
