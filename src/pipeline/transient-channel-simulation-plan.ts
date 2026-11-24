import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  planDrawing,
  type RouteSectionsInput,
  type SimulationPcbTransientChannelSimulationId,
} from "../board"
import type { IbisSources } from "../buffers"
import { type Produced, rootScope, sha256, snapshot } from "../kernel"
import type { RouteBindingsInput, RoutedTraceCut } from "../simulation"
import type { RoutedLane } from "./modeling"
import { routedReceiverMappings } from "./routed-receiver-paths"
import { compareNames, prepareChannelSimulation } from "./signals"
import {
  captureTransientChannelSimulationPlanInput,
  type TransientChannelSimulationPlanInput,
  type ValidatedBoard,
  type ValidatedChannelSimulation,
  validatePlanningBoard,
} from "./transient-channel-simulation-plan-input"
import {
  buildPlanVisualScene,
  type FailedPlanAttempt,
} from "./transient-channel-simulation-plan-visual"

/** Planning starts with the base route mesh resolution. */
const BASE_REFINEMENT = 1

/** Planning has no warnings before the downstream compilation stages. */
const PLAN_WARNINGS: readonly string[] = Object.freeze([])

/** Frozen section and binding inputs for one planned transient channel simulation. */
export interface TransientChannelSimulationPlan {
  readonly simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
  readonly name: string
  readonly sections: RouteSectionsInput
  readonly bindings: RouteBindingsInput
  readonly warnings: readonly string[]
}

/** The completed channel plans and their plan manifest. */
type TransientChannelSimulationPlanOutput = Produced<
  readonly TransientChannelSimulationPlan[]
>

/** Take the physical port pair from each cut, including loads beyond the receivers. */
function routedTraceCut(lane: RoutedLane): RoutedTraceCut {
  return {
    sourceTraceId: lane.sourceTraceId,
    fromSourcePortId: lane.from.sourcePortId,
    toSourcePortId: lane.to.sourcePortId,
  }
}

/** Lower the validated declaration into sectioning and binding inputs. */
function planTransientChannelSimulation({
  input,
  scopeDistanceMm,
  validatedChannelSimulation,
}: {
  input: TransientChannelSimulationPlanInput
  scopeDistanceMm: number
  validatedChannelSimulation: ValidatedChannelSimulation
}): TransientChannelSimulationPlan {
  const { channelSimulation, simulationPcbTransientChannelSimulationId } =
    validatedChannelSimulation
  const prepared = prepareChannelSimulation({
    boardCircuitJson: input.circuitJson,
    sources: input.ibisSources,
    ...validatedChannelSimulation,
    distanceMm: scopeDistanceMm,
  })
  const artifactPrefix = `channelSimulations/${simulationPcbTransientChannelSimulationId}`
  const circuitJson = structuredClone(prepared.circuit)
  const modeling = snapshot(prepared.settings)
  const routedTraceCuts = snapshot(modeling.lanes.map(routedTraceCut))
  const requiredSourcePortIds = Object.freeze([
    ...new Set(
      routedTraceCuts.flatMap(({ fromSourcePortId, toSourcePortId }) => [
        fromSourcePortId,
        toSourcePortId,
      ]),
    ),
  ])
  const mappings = snapshot(
    routedReceiverMappings({ prepared, cuts: routedTraceCuts }),
  )
  return Object.freeze({
    simulationPcbTransientChannelSimulationId,
    name: channelSimulation.name ?? simulationPcbTransientChannelSimulationId,
    warnings: PLAN_WARNINGS,
    sections: Object.freeze({
      circuitJson,
      copperScope: modeling.copperScope,
      requiredSourcePortIds,
      artifactPrefix,
    }),
    bindings: Object.freeze({
      circuitJson,
      mappings,
      routedTraceCuts,
      modeling,
      controls: snapshot(prepared.controls),
      ibisSources: input.ibisSources,
      options: Object.freeze({
        riseSeconds: prepared.riseSeconds,
        refinement: BASE_REFINEMENT,
        stepSeconds: prepared.stepSeconds,
        durationSeconds: prepared.durationSeconds,
      }),
      artifactPrefix,
    }),
  })
}

/** Publish the manifest and the completed plans as one immutable output. */
function finalizePlans({
  channelSimulationPlans,
  ibisSources,
}: {
  channelSimulationPlans: readonly TransientChannelSimulationPlan[]
  ibisSources: Readonly<IbisSources>
}): TransientChannelSimulationPlanOutput {
  const channelSimulations = channelSimulationPlans.map(
    ({ simulationPcbTransientChannelSimulationId, name, warnings }) => ({
      simulationPcbTransientChannelSimulationId,
      name,
      warnings,
    }),
  )
  const assetPaths = Object.keys(ibisSources).sort((a, b) =>
    compareNames({ a, b }),
  )
  const models = Object.fromEntries(
    assetPaths.map((assetPath) => [assetPath, sha256(ibisSources[assetPath])]),
  )
  const artifact = rootScope("pipeline").json(
    "transient-channel-simulation-plan.json",
    {
      channelSimulations,
      models,
    },
  )
  return Object.freeze({
    value: Object.freeze([...channelSimulationPlans]),
    artifacts: Object.freeze([Object.freeze(artifact)]),
  })
}

/** The plan solver performs exactly one channel simulation's lowering per step. */
export class TransientChannelSimulationPlanSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private readonly input: TransientChannelSimulationPlanInput
  private validatedBoard?: ValidatedBoard
  private readonly channelSimulationPlans: TransientChannelSimulationPlan[] = []
  private channelPcbTraceCount = 0
  private output?: TransientChannelSimulationPlanOutput
  private failedAttempt?: FailedPlanAttempt
  /** Capture a single board and model version for the whole planning run. */
  constructor(input: TransientChannelSimulationPlanInput) {
    super()
    this.input = captureTransientChannelSimulationPlanInput(input)
  }
  /** Prepare the next channel simulation and finalize once all plans are ready. */
  override _step(): void {
    this.validatedBoard ??= validatePlanningBoard(this.input)
    const { channelSimulations, scopeDistanceMm } = this.validatedBoard
    const validatedChannelSimulation =
      channelSimulations[this.channelSimulationPlans.length]
    if (validatedChannelSimulation) {
      try {
        const plan = planTransientChannelSimulation({
          input: this.input,
          scopeDistanceMm,
          validatedChannelSimulation,
        })
        this.channelSimulationPlans.push(plan)
        this.channelPcbTraceCount +=
          plan.sections.copperScope.channelPcbTraceIds.length
      } catch (error) {
        this.failedAttempt = {
          simulation: validatedChannelSimulation.channelSimulation,
          error,
        }
        throw error
      }
    }
    const channelSimulationCount = this.channelSimulationPlans.length
    this.stats = {
      channelSimulationCount,
      channelPcbTraceCount: this.channelPcbTraceCount,
    }
    if (channelSimulationCount !== channelSimulations.length) return
    this.output = finalizePlans({
      channelSimulationPlans: this.channelSimulationPlans,
      ibisSources: this.input.ibisSources,
    })
    this.solved = true
  }
  /** No partially planned channel simulation list escapes. */
  override getOutput(): TransientChannelSimulationPlanOutput {
    if (!this.output)
      throw new Error("Transient channel simulation plan is incomplete")
    return this.output
  }
  /** The input captured at construction. */
  override getConstructorParams(): ConstructorParameters<
    typeof TransientChannelSimulationPlanSolver
  > {
    return [
      Object.freeze({
        ...this.input,
        circuitJson: structuredClone(this.input.circuitJson),
      }),
    ]
  }
  /** Inspect the most recent attempted channel simulation and its board. */
  override visualize(): GraphicsObject {
    return planDrawing(
      buildPlanVisualScene({
        circuit: this.input.circuitJson,
        plan: this.channelSimulationPlans.at(-1),
        failed: this.failedAttempt,
        error:
          this.error?.replace(
            `${this.getSolverName()} error:`,
            "Transient channel plan error:",
          ) ?? null,
      }),
    )
  }
}
