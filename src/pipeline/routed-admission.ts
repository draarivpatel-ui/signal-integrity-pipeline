import { BaseSolver } from "@tscircuit/solver-utils"
import {
  type CircuitJson,
  getSourcePortConnectivityMapFromCircuitJson,
  type LaneMapping,
  passiveBridges,
  type RouteSectionsInput,
  type SimulationPcbDriverReceiverChannel,
  type SourceNetId,
  type SourcePortId,
  sourceConnections,
  sourceNetMembers,
  validateCircuitRecords,
} from "../board"
import { edgeSeconds, type IbisSources } from "../buffers"
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
type SourceId = SourcePortId | SourceNetId
type SourceTraceId = LaneMapping["sourceTraceId"]

interface RouteConnection {
  to: SourceId
  sourceTraceId?: SourceTraceId
}
type RouteConnections = Map<SourceId, RouteConnection[]>

/** Connect two source nodes, marking edges that represent extracted copper. */
function addRouteConnection(
  connections: RouteConnections,
  {
    from,
    to,
    sourceTraceId,
  }: RouteConnection & {
    from: SourceId
  },
): void {
  for (const [a, b] of [
    [from, to],
    [to, from],
  ]) {
    const neighbors = connections.get(a) ?? []
    neighbors.push({ to: b, sourceTraceId })
    connections.set(a, neighbors)
  }
}

/** Build the validated source topology, excluding reference rails and labeling routed traces. */
function blockRouteConnections({
  circuit,
  pins,
  settings,
}: PreparedBlock): RouteConnections {
  const connections: RouteConnections = new Map()
  if (!settings.lanes.length) return connections
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const references = circuit.flatMap((record) => {
    if (record.type === "source_net" && (record.is_ground || record.is_power))
      return [record.source_net_id]
    return []
  })
  for (const { ground, power } of pins.values()) references.push(ground, power)
  const rails = new Set(
    references.flatMap((port) => [...sourceNetMembers(connectivity, port)]),
  )
  // Visit routed parallels first when a source trace also declares the same connection.
  for (const lane of settings.lanes) {
    const { from, to, sourceTraceId } = lane
    if (!from.sourcePortId || !to.sourcePortId || !sourceTraceId) continue
    addRouteConnection(connections, {
      from: from.sourcePortId,
      to: to.sourcePortId,
      sourceTraceId,
    })
  }
  for (const [from, ...targets] of [
    ...sourceConnections(circuit),
    ...passiveBridges(circuit, rails),
  ]) {
    if (rails.has(from)) continue
    for (const to of targets) addRouteConnection(connections, { from, to })
  }
  return connections
}

/** Find a receiver path by visiting source nodes in breadth-first order. */
function pathTraceIds(
  connections: RouteConnections,
  {
    from,
    to,
  }: {
    from: SourcePortId
    to: SourcePortId
  },
): SourceTraceId[] {
  const paths = new Map<SourceId, SourceTraceId[]>([[from, []]])
  for (const [node, traceIds] of paths) {
    if (node === to) return traceIds
    for (const neighbor of connections.get(node) ?? []) {
      if (paths.has(neighbor.to)) continue
      const trace = neighbor.sourceTraceId
      paths.set(neighbor.to, trace ? [...traceIds, trace] : traceIds)
    }
  }
  return []
}

/** Match each receiver leg with the extracted traces along the corresponding driver path. */
function receiverMappings(
  signal: SimulationPcbDriverReceiverChannel,
  connections: RouteConnections,
): LaneMapping[] {
  const driverPorts = endpointPorts(signal.driver)
  return signal.receivers.flatMap((receiver) =>
    endpointPorts(receiver).flatMap((to, i) => {
      const from = driverPorts[i]
      const sourceTraceIds = pathTraceIds(connections, { from, to })
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
  const connections = blockRouteConnections(block)
  const mappings = block.signals.flatMap((signal) =>
    receiverMappings(signal, connections),
  )
  const experiment = block.circuit.find(
    (record) => record.type === "simulation_experiment",
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
  const driverPorts = block.signals.flatMap((signal) =>
    endpointPorts(signal.driver),
  )
  const driverRiseSeconds = driverPorts.map((id) =>
    edgeSeconds(block.pins.get(id)!),
  )
  const options: RoutedCompileOptions = {
    riseSeconds: Math.min(...driverRiseSeconds),
    refinement: BASE_REFINEMENT,
    stepSeconds: timePerStep / MILLISECONDS_PER_SECOND,
    durationSeconds: block.duration,
  }
  const artifactPrefix = `blocks/${id}`
  const circuitJson = snapshot(block.circuit)
  const modeling = snapshot(block.settings)
  const requiredSourcePortIds = modeling.lanes.flatMap((lane) => [
    lane.from.sourcePortId!,
    lane.to.sourcePortId!,
  ])
  Object.freeze(requiredSourcePortIds)
  return Object.freeze({
    id,
    name: block.block.name ?? id,
    warnings: snapshot(block.warnings),
    sections: Object.freeze({
      circuitJson,
      scope: modeling.copperScope,
      requiredSourcePortIds,
      referenceSourcePortId: modeling.channelReference!.sourcePortId!,
      artifactPrefix,
    }),
    bindings: Object.freeze({
      circuitJson,
      mappings: snapshot(mappings),
      modeling,
      controls: snapshot(block.controls),
      ibisSources: input.ibisSources,
      options: Object.freeze(options),
      artifactPrefix,
    }),
  })
}

/** Root admission performs exactly one SI block's lowering per step. */
export class RoutedAdmissionSolver extends BaseSolver {
  private readonly input: RoutedProblem
  private ids?: SafeId[]
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
      this.ids = signalBlocks(this.input.circuitJson).map((block) =>
        safeId(
          block.simulation_pcb_transient_channel_simulation_id,
          "simulationPcbTransientChannelSimulationId",
        ),
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
    if (id !== undefined) this.plans.push(planRoutedBlock(this.input, id))
    const selectedConductors = this.plans.reduce((count, plan) => {
      return count + plan.sections.scope.selectedPcbTraceIds.length
    }, 0)
    this.stats = { blocks: this.plans.length, selectedConductors }
    if (this.plans.length !== this.ids.length) return
    const value = this.plans.slice()
    Object.freeze(value)
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
