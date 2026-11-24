import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { type Produced, rootScope, type Snapshot, snapshot } from "../kernel"
import type { CopperGeometryExtractionInput } from "./copper-geometry-extraction-input"
import type { CopperScope } from "./geometry/scope"
import { findContactWire } from "./route-contacts"
import type { SectionGeometry } from "./route-section-types"
import { drawRouteSections } from "./route-section-visual"
import { type RouteSectionProgress, stepRouteSections } from "./route-sections"
import { getSoldermaskThicknessMm } from "./route-soldermask"
import { type CircuitJson, cloneCircuitJson } from "./schema"

/** Completed route geometry and its outer soldermask thickness when declared. */
export interface RouteSectionsOutput {
  circuitJson: Snapshot<CircuitJson>
  copperScope: Snapshot<CopperScope>
  geometry: Snapshot<SectionGeometry>
  maskThicknessMm: number | null
}

/** Require every input endpoint to contact modeled copper. */
function validateRequiredPorts({
  db,
  input,
  geometry,
}: {
  db: ReturnType<typeof cju>
  input: CopperGeometryExtractionInput
  geometry: SectionGeometry
}): void {
  for (const sourcePortId of input.requiredSourcePortIds) {
    const pcbPort = db.pcb_port.getWhere({ source_port_id: sourcePortId })
    if (
      pcbPort?.layers.some((layer) =>
        findContactWire({
          geometry,
          layer,
          point: [pcbPort.x, pcbPort.y],
          pcbPortId: pcbPort.pcb_port_id,
        }),
      )
    )
      continue
    throw new Error(
      `required endpoint ${sourcePortId} has no physical wire or via contact`,
    )
  }
}

/** Check whether a planning input can be reused as an immutable input. */
function isDeeplyFrozen(input: unknown): boolean {
  if (input === null || typeof input !== "object") return true
  return Object.isFrozen(input) && Object.values(input).every(isDeeplyFrozen)
}

/** Read mutable caller inputs once without duplicating already frozen planning values. */
function captureInput(
  input: CopperGeometryExtractionInput,
): CopperGeometryExtractionInput {
  const captured = {
    ...input,
    requiredSourcePortIds: snapshot(input.requiredSourcePortIds),
  }
  if (!isDeeplyFrozen(input.circuitJson))
    captured.circuitJson = snapshot(input.circuitJson)
  if (!isDeeplyFrozen(input.copperScope))
    captured.copperScope = snapshot(input.copperScope)
  return Object.freeze(captured)
}

/** Extract one trace per step, then verify the required endpoint contacts. */
export class RouteSectionsSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private steps?: Generator<RouteSectionProgress, SectionGeometry>
  private circuit?: CircuitJson
  private output?: Produced<RouteSectionsOutput>
  private readonly input: CopperGeometryExtractionInput

  /** Capture the board and its prepared copper scope. */
  constructor(input: CopperGeometryExtractionInput) {
    super()
    this.input = captureInput(input)
  }

  /** Report trace extraction counts, then publish the completed sections. */
  override _step(): void {
    this.circuit ??= cloneCircuitJson(this.input.circuitJson)
    this.steps ??= stepRouteSections({
      circuit: this.circuit,
      copperScope: this.input.copperScope,
    })
    const step = this.steps.next()
    if (!step.done) {
      this.stats = { ...step.value, sections: 0 }
      return
    }
    this.publishSections({ circuit: this.circuit, geometry: step.value })
  }

  /** Validate final geometry and publish the immutable stage artifacts. */
  private publishSections({
    circuit,
    geometry,
  }: {
    circuit: CircuitJson
    geometry: SectionGeometry
  }): void {
    const db = cju([...circuit])
    const [stackup] = db.pcb_stackup.list()
    const maskThicknessMm = getSoldermaskThicknessMm(stackup.layers)
    validateRequiredPorts({ db, input: this.input, geometry })
    const { circuitJson, copperScope, artifactPrefix } = this.input
    const routeSections: RouteSectionsOutput = Object.freeze({
      circuitJson,
      copperScope,
      geometry: snapshot(geometry),
      maskThicknessMm,
    })
    const artifactScope = rootScope("board").child(artifactPrefix)
    this.output = Object.freeze({
      value: routeSections,
      artifacts: snapshot([
        artifactScope.json("geometry.json", routeSections.geometry),
        artifactScope.json("scope.json", copperScope),
      ]),
    })
    this.stats = {
      ...this.stats,
      wires: geometry.wires.length,
      sections: geometry.sections.length,
    }
    this.solved = true
  }

  /** Completed immutable geometry. */
  override getOutput(): Produced<RouteSectionsOutput> {
    if (!this.output) throw new Error("Route sections are incomplete")
    return this.output
  }

  /** Draw the board and the geometry published by the section solver. */
  override visualize(): GraphicsObject {
    return drawRouteSections({
      db: cju(cloneCircuitJson(this.input.circuitJson)),
      geometry: this.output?.value.geometry,
      error: this.error || undefined,
    })
  }

  /** Original problem, independent of work state. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteSectionsSolver
  > {
    return [this.input]
  }
}
