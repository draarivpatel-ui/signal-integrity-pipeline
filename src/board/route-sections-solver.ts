import { BaseSolver } from "@tscircuit/solver-utils"
import { type Produced, rootScope, snapshot } from "../kernel"
import {
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "./connectivity"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import {
  routeContactFrame,
  routeSectionSteps,
  type SectionGeometry,
} from "./route-sections"
import type { CircuitJson } from "./schema"

/** The board, selected copper and required ports passed to route sectioning. */
export interface RouteSectionsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  requiredSourcePortIds: SourcePortId[]
  referenceSourcePortId: SourcePortId
  artifactPrefix: string
}
/** Completed route geometry and its outer soldermask thickness when declared. */
export interface RoutedSections {
  circuitJson: CircuitJson
  scope: CopperScope
  geometry: SectionGeometry
  maskThicknessMm: number | null
}

/** Segment one real route per step, then admit selected endpoint contacts. */
export class RouteSectionsSolver extends BaseSolver {
  private steps?: Generator<SectionGeometry, SectionGeometry>
  private output?: Produced<RoutedSections>
  private scope: CopperScope
  /** Capture source values and correct the owned AC rail scope. */
  constructor(private readonly input: RouteSectionsInput) {
    super()
    const connectivity = getSourcePortConnectivityMapFromCircuitJson(
      input.circuitJson,
    )
    const ground = sourceNetMembers({
      connectivity,
      seed: input.referenceSourcePortId,
    })
    const sourceTraces = input.circuitJson.filter(
      (record) => record.type === "source_trace",
    )
    const railTraces = sourceTraces.filter((trace) => {
      const connected = [
        ...trace.connected_source_port_ids,
        ...(trace.connected_source_net_ids ?? []),
      ]
      return connected.some((id) => ground.has(id))
    })
    const railSourceIds = railTraces.map((trace) => trace.source_trace_id)
    const railPcbIds = input.circuitJson
      .filter((record) => record.type === "pcb_trace")
      .filter((trace) => railSourceIds.includes(trace.source_trace_id!))
      .map((trace) => trace.pcb_trace_id)
    this.scope = {
      ...input.scope,
      nonReferenceRailTraceIds: [
        ...input.scope.nonReferenceRailTraceIds,
        ...railPcbIds,
      ],
    }
  }
  /** Each yield has performed one route's segmentation; the final pass slices actual references. */
  override _step(): void {
    this.steps ??= routeSectionSteps({
      circuit: this.input.circuitJson,
      scope: this.scope,
    })
    const result = this.steps.next()
    const geometry = result.value
    this.stats = {
      routes: Math.min(this.iterations, this.scope.pcbTraceIds.length),
      wires: geometry.wires.length,
      slices: geometry.slices.length,
    }
    if (!result.done) return

    const { circuitJson, requiredSourcePortIds, artifactPrefix } = this.input
    const [stackup] = circuitJson.filter(
      (record) => record.type === "pcb_stackup",
    )
    const masks = stackup.layers.filter(
      (layer) => layer.layer_type === "soldermask",
    )
    if (new Set(masks.map((layer) => layer.thickness)).size > 1) {
      throw new Error(
        "Asymmetric soldermask thickness requires separate outer-layer material profiles",
      )
    }
    for (const id of requiredSourcePortIds) {
      const port = circuitJson.find(
        (record) => record.type === "pcb_port" && record.source_port_id === id,
      )
      if (
        port?.type === "pcb_port" &&
        port.layers.some((layer) =>
          routeContactFrame({
            geometry,
            scope: this.scope,
            layer,
            point: [port.x, port.y],
          }),
        )
      )
        continue
      throw new Error(
        `selected endpoint ${id} has no physical wire or via contact`,
      )
    }

    const value = snapshot<RoutedSections>({
      circuitJson,
      scope: this.scope,
      geometry,
      maskThicknessMm: masks[0]?.thickness ?? null,
    })
    const scope = rootScope("board").child(artifactPrefix)
    this.output = {
      value,
      artifacts: [
        scope.json("geometry.json", value.geometry),
        scope.json("scope.json", value.scope),
      ],
    }
    this.solved = true
  }
  /** Completed immutable geometry only. */
  override getOutput(): Produced<RoutedSections> {
    if (!this.output) throw new Error("Route sections are incomplete")
    return this.output
  }
  /** Original problem, independent of work state. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteSectionsSolver
  > {
    return [this.input]
  }
}
