import { BaseSolver } from "@tscircuit/solver-utils"
import {
  type CircuitJson,
  type LaneMapping,
  type RouteSectionsInput,
  type SimulationPcbDriverReceiverChannel,
  validateCircuitRecords,
} from "../board"
import { edgeSeconds, type IbisSources } from "../buffers"
import { type Produced, rootScope, sha256, snapshot } from "../kernel"
import type { RouteBindingsInput, RoutedCompileOptions } from "../simulation"
import {
  endpointPorts,
  type PreparedBlock,
  prepareBlockById,
  signalBlocks,
} from "./signals"

/** Default and maximum radius of the admitted copper scope, in millimeters. */
const MAX_SCOPE_DISTANCE_MM = 32

/** Circuit JSON experiment records store milliseconds and routed stages use seconds. */
const MILLISECONDS_PER_SECOND = 1000

/** Admission starts with the base route mesh resolution. */
const BASE_REFINEMENT = 1

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
/** Match each receiver leg with the corresponding driver leg and its trace. */
function receiverMappings(
  signal: SimulationPcbDriverReceiverChannel,
  lanes: PreparedBlock["settings"]["lanes"],
): LaneMapping[] {
  const driverPorts = endpointPorts(signal.driver)
  return signal.receivers.flatMap((receiver) =>
    endpointPorts(receiver).map((to, i) => {
      const from = driverPorts[i]
      const lane = lanes.find(
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
  )
}

/** Copy IBIS UTF-8 bytes into immutable text without removing a BOM. */
function modelSourceText(sources: IbisSources): Record<string, string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  return Object.fromEntries(
    Object.entries(sources).map(([name, source]) => [
      name,
      typeof source === "string" ? source : decoder.decode(source),
    ]),
  )
}

/** Lower one admitted SI block into the routed stage inputs. */
function planRoutedBlock(input: RoutedProblem, id: string): RoutedBlockPlan {
  const block = prepareBlockById({
    circuit: input.circuitJson,
    sources: input.ibisSources,
    blockId: id,
    distanceMm: input.scopeDistanceMm ?? MAX_SCOPE_DISTANCE_MM,
  })
  const mappings = block.signals.flatMap((signal) =>
    receiverMappings(signal, block.settings.lanes),
  )
  const experiment = block.circuit.find(
    (record) => record.type === "simulation_experiment",
  )!
  if (experiment.type !== "simulation_experiment")
    throw new Error("Missing admitted experiment")
  const driverPorts = block.signals.flatMap((signal) =>
    endpointPorts(signal.driver),
  )
  const driverRiseSeconds = driverPorts.map((id) =>
    edgeSeconds(block.pins.get(id)!),
  )
  const options: RoutedCompileOptions = {
    riseSeconds: Math.min(...driverRiseSeconds),
    refinement: BASE_REFINEMENT,
    stepSeconds: experiment.time_per_step! / MILLISECONDS_PER_SECOND,
    durationSeconds: block.duration,
  }
  const artifactPrefix = `blocks/${id}`
  const requiredSourcePortIds = block.settings.lanes.flatMap((lane) => [
    lane.from.sourcePortId!,
    lane.to.sourcePortId!,
  ])
  return snapshot({
    id,
    name: block.block.name ?? id,
    warnings: block.warnings,
    sections: {
      circuitJson: block.circuit,
      scope: block.settings.copperScope,
      requiredSourcePortIds,
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
  private readonly input: RoutedProblem
  private ids?: string[]
  private readonly plans: RoutedBlockPlan[] = []
  private output?: Produced<RoutedBlockPlan[]>
  /** Capture a single board and model version for the whole admission run. */
  constructor(input: RoutedProblem) {
    super()
    this.input = snapshot({
      ...input,
      ibisSources: modelSourceText(input.ibisSources),
    })
  }
  /** Shared prepareBlockById retains the existing intent, warnings and model policy. */
  override _step(): void {
    if (!this.ids) {
      validateCircuitRecords(this.input.circuitJson)
      this.ids = signalBlocks(this.input.circuitJson).map(
        (block) => block.simulation_pcb_transient_channel_simulation_id,
      )
      const distance = this.input.scopeDistanceMm ?? MAX_SCOPE_DISTANCE_MM
      if (
        !Number.isFinite(distance) ||
        distance <= 0 ||
        distance > MAX_SCOPE_DISTANCE_MM
      ) {
        throw new Error(
          `Copper scope distance must be in (0,${MAX_SCOPE_DISTANCE_MM}] mm`,
        )
      }
    }
    const id = this.ids[this.plans.length]
    if (id) this.plans.push(planRoutedBlock(this.input, id))
    const selectedConductors = this.plans.reduce((count, plan) => {
      return count + plan.sections.scope.selectedPcbTraceIds.length
    }, 0)
    this.stats = { blocks: this.plans.length, selectedConductors }
    if (this.plans.length !== this.ids.length) return
    const value = snapshot(this.plans)
    const blocks = value.map(({ id, name, warnings }) => ({
      id,
      name,
      warnings,
    }))
    const modelHashes = Object.entries(this.input.ibisSources).map(
      ([name, bytes]) => [name, sha256(bytes)] as const,
    )
    const models = Object.fromEntries(modelHashes)
    const artifact = rootScope("pipeline").json("admission.json", {
      blocks,
      models,
    })
    this.output = { value, artifacts: [artifact] }
    this.solved = true
  }
  /** No partially admitted block list escapes. */
  override getOutput(): Produced<RoutedBlockPlan[]> {
    if (!this.output) throw new Error("Routed admission is incomplete")
    return this.output
  }
  /** The input captured at construction. */
  override getConstructorParams(): ConstructorParameters<
    typeof RoutedAdmissionSolver
  > {
    return [this.input]
  }
}
