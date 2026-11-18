import { BaseSolver } from "@tscircuit/solver-utils"
import type { RouteSectionsInput } from "../board"
import {
  type CircuitJson,
  type LaneMapping,
  validateCircuitRecords,
} from "../board"
import { edgeSeconds, type IbisSources } from "../buffers"
import { type Produced, rootScope, sha256, snapshot } from "../kernel"
import type { RouteBindingsInput, RoutedCompileOptions } from "../simulation"
import { endpointPorts, prepareBlockById, signalBlocks } from "./signals"

export interface RoutedProblem {
  circuitJson: CircuitJson
  ibisSources: IbisSources
  scopeDistanceMm?: number
}
export interface RoutedBlockPlan {
  id: string
  name: string
  sections: RouteSectionsInput
  bindings: Omit<RouteBindingsInput, "scope">
  warnings: string[]
}
/** Lower one admitted SI block into the routed stage inputs. */
function planRoutedBlock(input: RoutedProblem, id: string): RoutedBlockPlan {
  const block = prepareBlockById({
    circuit: input.circuitJson,
    sources: input.ibisSources,
    blockId: id,
    distanceMm: input.scopeDistanceMm ?? 32,
  })
  const mappings: LaneMapping[] = block.signals.flatMap((signal) =>
    signal.receivers.flatMap((receiver) =>
      endpointPorts(receiver).map((to, i) => {
        const from = endpointPorts(signal.driver)[i]
        const lane = block.settings.lanes.find(
          (lane) =>
            lane.from.sourcePortId === from || lane.to.sourcePortId === from,
        )!
        return {
          port: signal.name,
          from,
          to,
          sourceTraceId: lane.sourceTraceId!,
        }
      }),
    ),
  )
  const experiment = block.circuit.find(
    (record) => record.type === "simulation_experiment",
  )!
  if (experiment.type !== "simulation_experiment")
    throw new Error("Missing admitted experiment")
  const options: RoutedCompileOptions = {
    riseSeconds: Math.min(
      ...block.signals
        .flatMap((signal) => endpointPorts(signal.driver))
        .map((id) => edgeSeconds(block.pins.get(id)!)),
    ),
    refinement: 1,
    stepSeconds: experiment.time_per_step! / 1000,
    durationSeconds: block.duration,
  }
  const artifactPrefix = `blocks/${id}`
  return snapshot({
    id,
    name: block.block.name ?? id,
    warnings: block.warnings,
    sections: {
      circuitJson: block.circuit,
      scope: block.settings.copperScope,
      requiredSourcePortIds: block.settings.lanes.flatMap((lane) => [
        lane.from.sourcePortId!,
        lane.to.sourcePortId!,
      ]),
      referenceSourcePortId: block.settings.channelReference!.sourcePortId!,
      artifactPrefix,
    },
    bindings: {
      circuitJson: block.circuit,
      mappings,
      modeling: block.settings,
      controls: block.controls,
      ibisSources: input.ibisSources,
      options,
      artifactPrefix,
    },
  })
}

/** Root admission performs exactly one SI block's lowering per step. */
export class RoutedAdmissionSolver extends BaseSolver {
  private ids?: string[]
  private readonly plans: RoutedBlockPlan[] = []
  private output?: Produced<RoutedBlockPlan[]>
  /** No native capability is available during admission. */
  constructor(private readonly input: RoutedProblem) {
    super()
  }
  /** Shared prepareBlockById retains the existing intent, warnings and model policy. */
  override _step(): void {
    if (!this.ids) {
      validateCircuitRecords(this.input.circuitJson)
      this.ids = signalBlocks(this.input.circuitJson).map(
        (block) => block.simulation_pcb_transient_channel_simulation_id,
      )
      const distance = this.input.scopeDistanceMm ?? 32
      if (!Number.isFinite(distance) || distance <= 0 || distance > 32)
        throw new Error("Copper scope distance must be in (0,32] mm")
    }
    const id = this.ids[this.plans.length]
    if (id) this.plans.push(planRoutedBlock(this.input, id))
    this.stats = {
      blocks: this.plans.length,
      selectedConductors: this.plans.reduce(
        (n, plan) => n + plan.sections.scope.selectedPcbTraceIds.length,
        0,
      ),
    }
    if (this.plans.length !== this.ids.length) return
    const value = snapshot(this.plans)
    this.output = {
      value,
      artifacts: [
        rootScope("pipeline").json("admission.json", {
          blocks: value.map((plan) => ({
            id: plan.id,
            name: plan.name,
            warnings: plan.warnings,
          })),
          models: Object.fromEntries(
            Object.entries(this.input.ibisSources).map(([name, bytes]) => [
              name,
              sha256(bytes),
            ]),
          ),
        }),
      ],
    }
    this.solved = true
  }
  /** No partially admitted block list escapes. */
  override getOutput(): Produced<RoutedBlockPlan[]> {
    if (!this.output) throw new Error("Routed admission is incomplete")
    return this.output
  }
  /** Original input only. */
  override getConstructorParams(): ConstructorParameters<
    typeof RoutedAdmissionSolver
  > {
    return [this.input]
  }
}
