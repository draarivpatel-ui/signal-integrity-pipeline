import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  admissionRouteView,
  circuitJsonDb,
  type RouteSectionsInput,
  routeAdmissionMarks,
  routeBoardBox,
  routeBoardDrawing,
  routeFailure,
  routeLengths,
  routeStrip,
  routeView,
  type SimulationPcbTransientChannelSimulationId,
  scopedAdmissionDrawing,
  unscopedAdmissionDrawing,
  withRouteDrawing,
} from "../board"
import type { IbisSources } from "../buffers"
import { type Produced, rootScope, sha256, snapshot } from "../kernel"
import type { RouteBindingsInput, RoutedTraceCut } from "../simulation"
import type { RoutedLane } from "./modeling"
import {
  type AdmittedBoard,
  type AdmittedChannelSimulation,
  admitBoard,
  captureRoutedAdmissionInput,
  type RoutedAdmissionInput,
} from "./routed-admission-input"
import { routedReceiverMappings } from "./routed-receiver-paths"
import { compareNames, prepareChannelSimulation } from "./signals"

/** Admission starts with the base route mesh resolution. */
const BASE_REFINEMENT = 1

/** Frozen section and binding inputs for one admitted transient channel simulation. */
export interface RoutedChannelSimulationPlan {
  readonly simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
  readonly name: string
  readonly sections: RouteSectionsInput
  readonly bindings: RouteBindingsInput
  readonly warnings: readonly string[]
}

/** The completed channel plans and their admission manifest. */
type RoutedAdmissionOutput = Produced<readonly RoutedChannelSimulationPlan[]>

/** Take the physical port pair from each cut, including loads beyond the receivers. */
function routedTraceCut(lane: RoutedLane): RoutedTraceCut {
  return {
    sourceTraceId: lane.sourceTraceId,
    fromSourcePortId: lane.from.sourcePortId,
    toSourcePortId: lane.to.sourcePortId,
  }
}

/** Lower the validated declaration into sectioning and binding inputs. */
function planRoutedChannelSimulation({
  input,
  scopeDistanceMm,
  admittedChannelSimulation,
}: {
  input: RoutedAdmissionInput
  scopeDistanceMm: number
  admittedChannelSimulation: AdmittedChannelSimulation
}): RoutedChannelSimulationPlan {
  const { channelSimulation, simulationPcbTransientChannelSimulationId } =
    admittedChannelSimulation
  const prepared = prepareChannelSimulation({
    boardCircuitJson: input.circuitJson,
    sources: input.ibisSources,
    ...admittedChannelSimulation,
    distanceMm: scopeDistanceMm,
    captureDrivers: input.captureDrivers,
    disabledAggressorPorts: input.disabledAggressorPorts,
  })
  const artifactPrefix = `channelSimulations/${simulationPcbTransientChannelSimulationId}`
  const circuitJson = snapshot(prepared.circuit)
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
    warnings: snapshot(prepared.warnings ?? []),
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
        materials: input.materials,
      }),
      artifactPrefix,
    }),
  })
}

/** Publish the manifest and the completed plans as one immutable output. */
function finalizeAdmission({
  channelSimulationPlans,
  ibisSources,
}: {
  channelSimulationPlans: readonly RoutedChannelSimulationPlan[]
  ibisSources: Readonly<IbisSources>
}): RoutedAdmissionOutput {
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
  const artifact = rootScope("pipeline").json("admission.json", {
    channelSimulations,
    models,
  })
  return Object.freeze({
    value: Object.freeze([...channelSimulationPlans]),
    artifacts: Object.freeze([Object.freeze(artifact)]),
  })
}

/** Root admission performs exactly one channel simulation's lowering per step. */
export class RoutedAdmissionSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private readonly input: RoutedAdmissionInput
  private admittedBoard?: AdmittedBoard
  private readonly channelSimulationPlans: RoutedChannelSimulationPlan[] = []
  private channelPcbTraceCount = 0
  private output?: RoutedAdmissionOutput
  /** Capture a single board and model version for the whole admission run. */
  constructor(input: RoutedAdmissionInput) {
    super()
    this.input = captureRoutedAdmissionInput(input)
  }
  /** Prepare the next channel simulation and finalize once all plans are ready. */
  override _step(): void {
    this.admittedBoard ??= admitBoard(this.input)
    const { channelSimulations, scopeDistanceMm } = this.admittedBoard
    const admittedChannelSimulation =
      channelSimulations[this.channelSimulationPlans.length]
    if (admittedChannelSimulation) {
      const plan = planRoutedChannelSimulation({
        input: this.input,
        scopeDistanceMm,
        admittedChannelSimulation,
      })
      this.channelSimulationPlans.push(plan)
      this.channelPcbTraceCount +=
        plan.sections.copperScope.channelPcbTraceIds.length
    }
    const channelSimulationCount = this.channelSimulationPlans.length
    this.stats = {
      channelSimulationCount,
      channelPcbTraceCount: this.channelPcbTraceCount,
    }
    if (channelSimulationCount !== channelSimulations.length) return
    this.output = finalizeAdmission({
      channelSimulationPlans: this.channelSimulationPlans,
      ibisSources: this.input.ibisSources,
    })
    this.solved = true
  }
  /** No partially admitted channel simulation list escapes. */
  override getOutput(): RoutedAdmissionOutput {
    if (!this.output) throw new Error("Routed admission is incomplete")
    return this.output
  }
  /** The input captured at construction. */
  override getConstructorParams(): ConstructorParameters<
    typeof RoutedAdmissionSolver
  > {
    return [this.input]
  }
  /** Inspect the latest channel's copper and endpoints or the whole unscoped board. */
  visualizeCopper(): GraphicsObject {
    const circuit = this.input.circuitJson
    const plan = this.channelSimulationPlans.at(-1)
    if (plan === undefined)
      return unscopedAdmissionDrawing({ circuit, error: this.error })
    const { mappings } = plan.bindings
    const db = circuitJsonDb(circuit)
    const view = admissionRouteView({
      db,
      scope: plan.sections.copperScope,
      endpointSourcePortIds: new Set(
        mappings.flatMap(({ from, to }) => [from, to]),
      ),
    })
    return scopedAdmissionDrawing({
      db,
      view,
      mappings,
      error: this.error,
    })
  }
  /** Add the stage camera and its routed-length pane to the shared copper drawing. */
  override visualize(): GraphicsObject {
    const circuit = this.input.circuitJson
    const plan = this.channelSimulationPlans.at(-1)
    const scope = plan?.sections.copperScope
    const board = routeBoardDrawing({ circuit, scope })
    if (plan === undefined || scope === undefined) {
      if (this.error === null) return board
      return {
        ...board,
        texts: routeFailure({
          box: routeBoardBox(circuit),
          message: this.error,
        }),
      }
    }
    const view = routeView({ circuit, scope })
    const drawing = withRouteDrawing({
      drawing: board,
      overlay: routeStrip({
        pane: view.pane,
        rows: routeLengths({ circuit, view }),
      }),
    })
    const marks = routeAdmissionMarks({
      db: circuitJsonDb(circuit),
      mappings: plan.bindings.mappings,
      view,
    })
    const polygons = [...drawing.polygons, ...marks]
    if (this.error === null) return { ...drawing, polygons }
    return {
      ...drawing,
      polygons,
      texts: [
        ...drawing.texts,
        ...routeFailure({ box: view.pane, message: this.error }),
      ],
    }
  }
}
