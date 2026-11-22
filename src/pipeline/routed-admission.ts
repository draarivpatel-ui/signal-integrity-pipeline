import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { SourceTrace } from "circuit-json"
import type { GraphicsObject } from "graphics-debug"
import {
  type CircuitJson,
  getSourcePortConnectivityMapFromCircuitJson,
  type LaneMapping,
  passiveBridges,
  type RouteSectionsInput,
  routeBoardBox,
  routeBoardDrawing,
  routeFailure,
  routeLengths,
  routeMarks,
  routePortPoint,
  routeStrip,
  routeView,
  type SimulationPcbDriverReceiverChannel,
  type SourceNetId,
  type SourcePortId,
  sourceConnections,
  validateCircuitRecords,
  withRouteDrawing,
} from "../board"
import { edgeDurationSeconds, type IbisSources } from "../buffers"
import {
  type Produced,
  rootScope,
  type SafeId,
  safeId,
  sha256,
  snapshot,
} from "../kernel"
import type { RouteBindingsInput, RoutedCompileOptions } from "../simulation"
import {
  collectRailIds,
  endpointPorts,
  listChannelSimulations,
  type PreparedChannelSimulation,
  prepareChannelSimulationById,
} from "./signals"

/** Default and maximum radius of the admitted copper scope, in millimeters. */
const MAX_SCOPE_DISTANCE_MM = 32

/** Circuit JSON experiment records store milliseconds and routed stages use seconds. */
const MILLISECONDS_PER_SECOND = 1000

/** Admission starts with the base route mesh resolution. */
const BASE_REFINEMENT = 1

/** Circuit and model bytes supplied to routed admission. */
export interface RoutedProblem {
  circuitJson: CircuitJson
  ibisSources: IbisSources
  scopeDistanceMm?: number
  materials?: RoutedCompileOptions["materials"]
}
/** Frozen section and binding inputs for one admitted transient channel simulation. */
export interface RoutedChannelSimulationPlan {
  id: SafeId
  name: string
  sections: RouteSectionsInput
  bindings: Omit<RouteBindingsInput, "scope">
  warnings: string[]
}
/** A source port or a named net participating in a receiver path. */
type SourceId = SourcePortId | SourceNetId
type SourceTraceId = SourceTrace["source_trace_id"]

/** Ordered routed trace identifiers along a receiver path. */
type PathTraceIds = SourceTraceId[]

/** Validated channel simulation IDs in board order. */
type RoutedChannelSimulationIds = SafeId[]

/** Immutable IBIS text keyed by the declared asset path. */
type ModelSourceText = Record<string, string>

/** One declared asset path and its SHA-256 digest. */
type ModelHash = [path: string, sha256: string]

/** Endpoints of the routed traces that sectioning must physically contact. */
type RequiredSourcePortIds = RouteSectionsInput["requiredSourcePortIds"]

/** A path edge and its optional extracted source trace. */
interface RouteConnection {
  to: SourceId
  sourceTraceId?: SourceTraceId
}
/** Source adjacency retaining edge order and routed trace labels. */
type RouteConnections = Map<SourceId, RouteConnection[]>

/** Undirected source connection, optionally carried by an extracted trace. */
type RouteEdge = RouteConnection & { from: SourceId }

/** Build the validated source topology, excluding reference rails and labeling routed traces. */
function channelSimulationRouteConnections({
  circuit,
  pins,
  settings,
}: PreparedChannelSimulation): RouteConnections {
  const connections: RouteConnections = new Map()
  if (!settings.lanes.length) return connections
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const rails = collectRailIds({ circuit, connectivity, pins })
  const edges: RouteEdge[] = []
  // Visit routed parallels first when a source trace also declares the same connection.
  for (const lane of settings.lanes) {
    const { from, to, sourceTraceId } = lane
    if (!from.sourcePortId || !to.sourcePortId || !sourceTraceId) continue
    edges.push({
      from: from.sourcePortId,
      to: to.sourcePortId,
      sourceTraceId,
    })
  }
  for (const [from, ...targets] of [
    ...sourceConnections(circuit),
    ...passiveBridges({ circuit, excluded: rails }),
  ]) {
    if (rails.has(from)) continue
    for (const to of targets) edges.push({ from, to })
  }
  for (const { from, to, sourceTraceId } of edges) {
    for (const [a, b] of [
      [from, to],
      [to, from],
    ]) {
      const neighbors = connections.get(a) ?? []
      neighbors.push({ to: b, sourceTraceId })
      connections.set(a, neighbors)
    }
  }
  return connections
}

/** Find a receiver path by visiting source nodes in breadth-first order. */
function pathTraceIds({
  connections,
  from,
  to,
}: {
  connections: RouteConnections
  from: SourcePortId
  to: SourcePortId
}): PathTraceIds {
  const paths = new Map<SourceId, PathTraceIds>([[from, []]])
  for (const [node, traceIds] of paths) {
    if (node === to) return traceIds
    for (const neighbor of connections.get(node) ?? []) {
      if (paths.has(neighbor.to)) continue
      const trace = neighbor.sourceTraceId
      if (trace) {
        paths.set(neighbor.to, [...traceIds, trace])
        continue
      }
      paths.set(neighbor.to, traceIds)
    }
  }
  return []
}

/** Match each receiver leg with the extracted traces along the corresponding driver path. */
function receiverMappings({
  signal,
  connections,
}: {
  signal: SimulationPcbDriverReceiverChannel
  connections: RouteConnections
}): LaneMapping[] {
  const driverPorts = endpointPorts(signal.driver)
  return signal.receivers.flatMap((receiver) =>
    endpointPorts(receiver).flatMap((to, i) => {
      const from = driverPorts[i]
      const sourceTraceIds = pathTraceIds({ connections, from, to })
      const [sourceTraceId] = sourceTraceIds
      if (sourceTraceId === undefined) return []
      const mapping: LaneMapping = {
        port: signal.name,
        from,
        to,
        sourceTraceId,
      }
      if (sourceTraceIds.length > 1) mapping.sourceTraceIds = sourceTraceIds
      return [mapping]
    }),
  )
}

/** Copy IBIS UTF-8 bytes into immutable text without removing a BOM. */
function modelSourceText(sources: IbisSources): ModelSourceText {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  return Object.fromEntries(
    Object.entries(sources).map(([name, source]) => {
      if (typeof source === "string") return [name, source]
      return [name, decoder.decode(source)]
    }),
  )
}

/** Lower one admitted channel simulation into the routed stage inputs. */
function planRoutedChannelSimulation({
  input,
  id,
}: {
  input: RoutedProblem
  id: SafeId
}): RoutedChannelSimulationPlan {
  const prepared = prepareChannelSimulationById({
    circuit: input.circuitJson,
    sources: input.ibisSources,
    simulationPcbTransientChannelSimulationId: id,
    distanceMm: input.scopeDistanceMm ?? MAX_SCOPE_DISTANCE_MM,
  })
  const connections = channelSimulationRouteConnections(prepared)
  const mappings = prepared.driverReceiverChannels.flatMap((signal) =>
    receiverMappings({ signal, connections }),
  )
  const experiment = cju([...prepared.circuit]).simulation_experiment.getWhere(
    {},
  )
  if (!experiment) throw new Error("Missing admitted experiment")
  const { time_per_step: timePerStep } = experiment
  if (
    timePerStep === undefined ||
    !Number.isFinite(timePerStep) ||
    timePerStep <= 0
  ) {
    throw new Error(
      "The admitted experiment requires a finite positive time_per_step",
    )
  }
  const driverPorts = prepared.driverReceiverChannels.flatMap((signal) =>
    endpointPorts(signal.driver),
  )
  const driverRiseSeconds = driverPorts.map((id) =>
    edgeDurationSeconds(prepared.pins.get(id)!),
  )
  const options: RoutedCompileOptions = {
    riseSeconds: Math.min(...driverRiseSeconds),
    refinement: BASE_REFINEMENT,
    stepSeconds: timePerStep / MILLISECONDS_PER_SECOND,
    durationSeconds: prepared.durationSeconds,
    materials: input.materials,
  }
  const artifactPrefix = `blocks/${id}`
  const circuitJson = snapshot(prepared.circuit)
  const modeling = snapshot(prepared.settings)
  const requiredSourcePortIds: RequiredSourcePortIds = modeling.lanes.flatMap(
    (lane) => [lane.from.sourcePortId!, lane.to.sourcePortId!],
  )
  Object.freeze(requiredSourcePortIds)
  return Object.freeze({
    id,
    name: prepared.channelSimulation.name ?? id,
    warnings: snapshot(prepared.warnings ?? []),
    sections: Object.freeze({
      circuitJson,
      scope: modeling.copperScope,
      requiredSourcePortIds,
      artifactPrefix,
    }),
    bindings: Object.freeze({
      circuitJson,
      mappings: snapshot(mappings),
      modeling,
      controls: snapshot(prepared.controls),
      ibisSources: input.ibisSources,
      options: Object.freeze(options),
      artifactPrefix,
    }),
  })
}

/** Root admission performs exactly one channel simulation's lowering per step. */
export class RoutedAdmissionSolver extends BaseSolver {
  private readonly input: RoutedProblem
  private ids?: RoutedChannelSimulationIds
  private readonly plans: RoutedChannelSimulationPlan[] = []
  private output?: Produced<RoutedChannelSimulationPlan[]>
  /** Capture a single board and model version for the whole admission run. */
  constructor(input: RoutedProblem) {
    super()
    this.input = snapshot({
      ...input,
      ibisSources: modelSourceText(input.ibisSources),
    })
  }
  /** Validate the shared inputs and collect the ordered channel simulation IDs on first use. */
  private channelSimulationIds(): RoutedChannelSimulationIds {
    if (this.ids) return this.ids
    validateCircuitRecords(this.input.circuitJson)
    this.ids = listChannelSimulations(this.input.circuitJson).map(
      (channelSimulation) =>
        safeId({
          raw: channelSimulation.simulation_pcb_transient_channel_simulation_id,
          field: "simulationPcbTransientChannelSimulationId",
        }),
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
    return this.ids
  }
  /** Use shared channel simulation preparation for channel intent and model policy. */
  override _step(): void {
    const ids = this.channelSimulationIds()
    const id = ids[this.plans.length]
    if (id !== undefined)
      this.plans.push(planRoutedChannelSimulation({ input: this.input, id }))
    const selectedConductors = this.plans.reduce((count, plan) => {
      return count + plan.sections.scope.channelPcbTraceIds.length
    }, 0)
    this.stats = { channelSimulations: this.plans.length, selectedConductors }
    if (this.plans.length !== ids.length) return
    const value = this.plans.slice()
    Object.freeze(value)
    const channelSimulations = value.map(({ id, name, warnings }) => ({
      id,
      name,
      warnings,
    }))
    const modelHashes = Object.entries(this.input.ibisSources).map(
      ([name, bytes]): ModelHash => [name, sha256(bytes)],
    )
    const models = Object.fromEntries(modelHashes)
    const artifact = rootScope("pipeline").json("admission.json", {
      blocks: channelSimulations,
      models,
    })
    this.output = { value, artifacts: [artifact] }
    this.solved = true
  }
  /** No partially admitted channel simulation list escapes. */
  override getOutput(): Produced<RoutedChannelSimulationPlan[]> {
    if (!this.output) throw new Error("Routed admission is incomplete")
    return this.output
  }
  /** The input captured at construction. */
  override getConstructorParams(): ConstructorParameters<
    typeof RoutedAdmissionSolver
  > {
    return [this.input]
  }

  /**
   * Selected copper in net colours with drivers as dots and receivers as rings, and each net's routed length
   * unrolled in the pane; a rejection writes one red reason.
   */
  override visualize(): GraphicsObject {
    const plan = this.plans.at(-1)
    const circuit = this.input.circuitJson
    let drawing = routeBoardDrawing({ circuit, scope: plan?.sections.scope })
    if (!plan) {
      if (this.failed)
        drawing.texts!.push(
          ...routeFailure({
            box: routeBoardBox(circuit),
            message: this.error ?? "Invalid signal scope",
          }),
        )
      return drawing
    }
    const view = routeView({ circuit, scope: plan.sections.scope })
    drawing = withRouteDrawing({
      drawing: drawing,
      overlay: routeStrip({
        pane: view.pane,
        rows: routeLengths({ circuit, view }),
      }),
    })
    drawing.polygons!.push(
      ...routeMarks({
        marks: plan.bindings.mappings.flatMap((mapping) =>
          (
            [
              [mapping.from, true],
              [mapping.to, false],
            ] as const
          ).flatMap(([id, driver]) => {
            const point = routePortPoint({ circuit, sourcePortId: id })
            if (!point) return []
            const net = view.ports.get(id)
            return [
              {
                point,
                color: net?.color ?? "#ffffff",
                driver,
                label: net?.label,
              },
            ]
          }),
        ),
        unit: view.unit,
      }),
    )
    if (this.failed)
      drawing.texts!.push(
        ...routeFailure({
          box: view.pane,
          message: this.error ?? "Invalid signal scope",
        }),
      )
    return drawing
  }
}
