import atan from "@stdlib/math-base-special-atan"
import log from "@stdlib/math-base-special-ln"
import log1p from "@stdlib/math-base-special-log1p"
import sin from "@stdlib/math-base-special-sin"
import sinh from "@stdlib/math-base-special-sinh"
import { hypotenuse } from "../kernel"
import type { BoundaryPanel } from "./cross-section-types"

/** Four-point Gauss–Legendre nodes and weights on the interval [-1, 1]. */
const quadrature = [
  [-0.8611363115940526, 0.3478548451374538],
  [-0.3399810435848563, 0.6521451548625461],
  [0.3399810435848563, 0.6521451548625461],
  [0.8611363115940526, 0.3478548451374538],
]

/** Cross-product tolerance for deciding whether the panel directions are parallel. */
const PARALLEL_TOLERANCE = 1e-14

/** Length ratio and separation limits for the analytic parallel-panel integral. */
const MAX_PARALLEL_LENGTH_RATIO = 30
/** Separation in units of the longer panel length. */
const MAX_PARALLEL_SEPARATION = 3

/** The coplanar limit of the across-panel field is zero. */
const COPLANAR_TOLERANCE = 1e-15

/** Two-plane interactions at greater horizontal separation than this have negligible weight. */
const MAX_SEPARATION_IN_PLANE_HEIGHTS = 200

/** Keep the analytic singularity correction within this many combined panel lengths. */
const NEAR_PANEL_LENGTHS = 2

/** Integrated log singularity across a panel's own length. */
const SELF_LOG_INTEGRAL = 1.5

/** Antiderivative of log distance, including points on a source panel. */
function logDistanceIntegral({ x, y }: { x: number; y: number }): number {
  let correction = 0
  if (y) correction = Math.abs(y) * atan(x / Math.abs(y))
  return x * log(hypotenuse(x, y) || 1) - x + correction
}

/** Second antiderivative of log distance, for exact Galerkin integration of parallel panels. */
function logDistanceDoubleIntegral({ x, y }: { x: number; y: number }): number {
  const r = hypotenuse(x, y)
  let logarithm = 0
  let correction = 0
  if (r) logarithm = 0.5 * (x * x - y * y) * log(r)
  if (y) correction = Math.abs(y) * x * atan(x / Math.abs(y))
  return logarithm - 0.75 * x * x + correction
}

/** Normal derivative of the second primitive; the coplanar principal value is zero. */
function normalFieldDoubleIntegral({ x, y }: { x: number; y: number }): number {
  if (!y) return 0
  return (
    Math.sign(y) *
    (x * atan(x / Math.abs(y)) - Math.abs(y) * (log(hypotenuse(x, y)) + 0.5))
  )
}

/** Exact potential or upward field primitive at one endpoint pair. */
function parallelPanelIntegral({
  x,
  v,
  tangentX,
  tangentZ,
  isNormalField,
}: {
  x: number
  v: number
  tangentX: number
  tangentZ: number
  isNormalField: boolean
}): number {
  if (isNormalField)
    return (
      tangentZ * logDistanceIntegral({ x, y: v }) +
      tangentX * normalFieldDoubleIntegral({ x, y: v })
    )
  return -logDistanceDoubleIntegral({ x, y: v })
}

/** Target and source panels for the kernel interaction. */
interface PanelPair {
  targetPanel: BoundaryPanel
  sourcePanel: BoundaryPanel
}

/** Analytic source integral, with four-point target averaging, for the free-space logarithmic kernel. */
function evaluateFreeKernel({
  targetPanel,
  sourcePanel,
  isMirrored,
  isNormalField,
}: PanelPair & {
  isMirrored?: boolean
  isNormalField: boolean
}): number {
  let tangentZ = sourcePanel.tangentZ
  let sourceZ = sourcePanel.centerZMm
  if (isMirrored) {
    tangentZ = -tangentZ
    sourceZ = -sourceZ
  }
  const dx = targetPanel.centerXMm - sourcePanel.centerXMm
  const dz = targetPanel.centerZMm - sourceZ
  const isParallel =
    Math.abs(
      targetPanel.tangentX * tangentZ -
        targetPanel.tangentZ * sourcePanel.tangentX,
    ) < PARALLEL_TOLERANCE
  const longer = Math.max(targetPanel.lengthMm, sourcePanel.lengthMm)
  const hasComparableLength =
    longer <
    MAX_PARALLEL_LENGTH_RATIO *
      Math.min(targetPanel.lengthMm, sourcePanel.lengthMm)
  if (
    isParallel &&
    hasComparableLength &&
    hypotenuse(dx, dz) < MAX_PARALLEL_SEPARATION * longer
  ) {
    const u = dx * sourcePanel.tangentX + dz * tangentZ
    const v = -dx * tangentZ + dz * sourcePanel.tangentX
    const h = (targetPanel.lengthMm + sourcePanel.lengthMm) / 2
    const d = (targetPanel.lengthMm - sourcePanel.lengthMm) / 2
    const projection = {
      v,
      tangentX: sourcePanel.tangentX,
      tangentZ,
      isNormalField,
    }
    const high =
      parallelPanelIntegral({ x: u + h, ...projection }) -
      parallelPanelIntegral({ x: u + d, ...projection })
    const low = parallelPanelIntegral({ x: u - d, ...projection })
    const end = parallelPanelIntegral({ x: u - h, ...projection })
    return (
      (high - low + end) /
      (2 * Math.PI * targetPanel.lengthMm * sourcePanel.lengthMm)
    )
  }
  // For unequal potential panels, average over the shorter panel and integrate the longer one.
  if (
    !isNormalField &&
    !isMirrored &&
    targetPanel.lengthMm > sourcePanel.lengthMm
  )
    return evaluateFreeKernel({
      targetPanel: sourcePanel,
      sourcePanel: targetPanel,
      isNormalField: false,
    })
  let result = 0
  for (const [t, weight] of quadrature) {
    const dx =
      targetPanel.centerXMm +
      (t * targetPanel.tangentX * targetPanel.lengthMm) / 2 -
      sourcePanel.centerXMm
    const dz =
      targetPanel.centerZMm +
      (t * targetPanel.tangentZ * targetPanel.lengthMm) / 2 -
      sourceZ
    const u = dx * sourcePanel.tangentX + dz * tangentZ
    const v = -dx * tangentZ + dz * sourcePanel.tangentX
    const h = sourcePanel.lengthMm / 2
    if (!isNormalField) {
      const potential =
        -(
          logDistanceIntegral({ x: u + h, y: v }) -
          logDistanceIntegral({ x: u - h, y: v })
        ) /
        (2 * Math.PI * sourcePanel.lengthMm)
      result += (potential * weight) / 2
      continue
    }
    const along =
      log(hypotenuse(u + h, v) / hypotenuse(u - h, v)) / sourcePanel.lengthMm
    let across = 0
    const separation = Math.abs(v)
    if (!(separation < COPLANAR_TOLERANCE)) {
      const angle = atan((u + h) / separation) - atan((u - h) / separation)
      across = (Math.sign(v) * angle) / sourcePanel.lengthMm
    }
    const field =
      (tangentZ * along + sourcePanel.tangentX * across) / (2 * Math.PI)
    result += (field * weight) / 2
  }
  return result
}

/** Integrated free-space interaction before applying grounded-plane images. */
function evaluateDirectKernel({
  targetPanel,
  sourcePanel,
  isNormalField,
}: PanelPair & { isNormalField: boolean }): number {
  if (targetPanel !== sourcePanel)
    return evaluateFreeKernel({ targetPanel, sourcePanel, isNormalField })
  if (isNormalField) return 0
  return (-log(targetPanel.lengthMm) + SELF_LOG_INTEGRAL) / (2 * Math.PI)
}

/** Grounded half-space or exact two-plane Green function; no meshed planes or vertical truncation.
 * The logarithmic singularity is integrated analytically. Only the smooth two-plane correction
 * needs double quadrature. Dielectric rows request the upward normal electric field instead.
 */
export function evaluatePanelKernel({
  targetPanel,
  sourcePanel,
  planeSpacingMm,
}: PanelPair & { planeSpacingMm: number }): number {
  const isNormalField = targetPanel.conductorIndex < 0
  const self = evaluateDirectKernel({
    targetPanel,
    sourcePanel,
    isNormalField,
  })
  if (!planeSpacingMm) {
    return (
      self -
      evaluateFreeKernel({
        targetPanel,
        sourcePanel,
        isMirrored: true,
        isNormalField,
      })
    )
  }
  const horizontalGap =
    Math.abs(targetPanel.centerXMm - sourcePanel.centerXMm) -
    (targetPanel.lengthMm + sourcePanel.lengthMm) / 2
  if (horizontalGap > MAX_SEPARATION_IN_PLANE_HEIGHTS * planeSpacingMm) return 0
  const isNear =
    hypotenuse(
      targetPanel.centerXMm - sourcePanel.centerXMm,
      targetPanel.centerZMm - sourcePanel.centerZMm,
    ) <
    NEAR_PANEL_LENGTHS * (targetPanel.lengthMm + sourcePanel.lengthMm)
  let result = 0
  if (isNear) result = self
  for (const [ta, wa] of quadrature) {
    for (const [tb, wb] of quadrature) {
      const dx =
        targetPanel.centerXMm -
        sourcePanel.centerXMm +
        (ta * targetPanel.tangentX * targetPanel.lengthMm -
          tb * sourcePanel.tangentX * sourcePanel.lengthMm) /
          2
      const za =
        targetPanel.centerZMm +
        (ta * targetPanel.tangentZ * targetPanel.lengthMm) / 2
      const zb =
        sourcePanel.centerZMm +
        (tb * sourcePanel.tangentZ * sourcePanel.lengthMm) / 2
      const dz = za - zb
      const u = (Math.PI * dx) / planeSpacingMm
      const v = (Math.PI * dz) / planeSpacingMm
      const s = (Math.PI * (za + zb)) / planeSpacingMm
      // Double quadrature points can be much farther apart than the nearest panel edges.
      const horizontalSeparation = Math.abs(dx) / planeSpacingMm
      if (horizontalSeparation > MAX_SEPARATION_IN_PLANE_HEIGHTS) {
        if (isNear && isNormalField)
          result -= (wa * wb * dz) / (8 * Math.PI * (dx * dx + dz * dz))
        if (isNear && !isNormalField)
          result += (wa * wb * log(hypotenuse(dx, dz))) / (8 * Math.PI)
        continue
      }
      const denominator = 2 * (sinh(u / 2) ** 2 + sin(v / 2) ** 2)
      const difference =
        2 *
        sin((Math.PI * za) / planeSpacingMm) *
        sin((Math.PI * zb) / planeSpacingMm)
      const numerator = denominator + difference
      const isCoincident = dx === 0 && dz === 0
      if (isCoincident) {
        if (isNormalField)
          result -= (wa * wb * sin(s)) / (16 * planeSpacingMm * numerator)
        if (!isNormalField)
          result +=
            (wa * wb * log(numerator * 2 * (planeSpacingMm / Math.PI) ** 2)) /
            (16 * Math.PI)
        continue
      }
      if (isNormalField) {
        let field =
          (sin(v) / denominator - sin(s) / numerator) / (4 * planeSpacingMm)
        if (isNear) field -= dz / (2 * Math.PI * (dx * dx + dz * dz))
        result += (wa * wb * field) / 4
        continue
      }
      let potential = log1p(difference / denominator) / (4 * Math.PI)
      if (isNear) potential += log(hypotenuse(dx, dz)) / (2 * Math.PI)
      result += (wa * wb * potential) / 4
    }
  }
  return result
}
