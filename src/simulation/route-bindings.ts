import { BaseSolver } from "@tscircuit/solver-utils"
import { circuitJsonDb } from "../board"
import {
  type AdmittedBuffers,
  type AssemblyEntry,
  admitBuffers,
  compileBuffers,
  ibisAssembly,
} from "../buffers"
import {
  type Artifact,
  type ArtifactScope,
  type Produced,
  rootScope,
  snapshot,
} from "../kernel"
import { generalDeclarations, modelRunDefinition } from "./declarations"
import { electricalSources } from "./netlist"
import type {
  RouteBuffer,
  RoutedBindings,
  ScopedRouteBindingsInput,
} from "./routed-types"
import { extractedNonrailSourceTraceIds } from "./source-node-groups"
import type { Declarations, SimulationPlan } from "./types"

/** Bind one vendor buffer per step; electrical names retain source-record order. */
export class RouteBindingsSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private declarations?: Declarations
  private admitted?: AdmittedBuffers
  private plan?: SimulationPlan
  private electricalLines: string[] = []
  private readonly models: RouteBuffer[] = []
  private readonly assembly: AssemblyEntry[] = []
  private readonly artifacts: Artifact[] = []
  private output?: Produced<RoutedBindings>
  /** Inputs contain domain intent, never another stage's internals. */
  constructor(private readonly input: ScopedRouteBindingsInput) {
    super()
  }
  /** Allocate circuit nodes before compiling the first IBIS buffer. */
  private initialize(scope: ArtifactScope): Declarations {
    if (this.declarations) return this.declarations
    const {
      circuitJson,
      copperScope,
      mappings,
      routedTraceCuts,
      modeling,
      controls,
      options,
      ibisSources,
    } = this.input
    if (!routedTraceCuts.length)
      throw new Error("Routed compilation requires physical signal mappings")
    const additionalSourceTraceIds = extractedNonrailSourceTraceIds({
      db: circuitJsonDb(circuitJson),
      copperScope,
    })
    const declarations = generalDeclarations({
      circuit: circuitJson,
      mappings,
      routedTraceCuts,
      additionalSourceTraceIds,
      modeling,
      controls,
    })
    this.declarations = declarations
    this.plan = {
      ...declarations.plans[0],
      durationSeconds: options.durationSeconds,
      maxStepSeconds: options.stepSeconds,
    }
    this.electricalLines = electricalSources({
      circuit: circuitJson,
      modeling,
      nodes: declarations.nodes,
    }).lines
    const admitted = admitBuffers({
      models: declarations.models,
      ibisSources,
      scope,
    })
    this.admitted = admitted.value
    this.artifacts.push(...admitted.artifacts)
    return declarations
  }

  /** Cut physical copper out of ideal connectivity, then compile one original IBIS model. */
  override _step(): void {
    const scope = rootScope("buffers").child(this.input.artifactPrefix)
    const declarations = this.initialize(scope)
    const model = declarations.models[this.models.length]
    if (model) {
      const [compiled] = compileBuffers({
        admitted: this.admitted!,
        plans: [{ ...this.plan!, models: [model] }],
        define: modelRunDefinition,
      })[0]
      this.models.push({
        name: compiled.name,
        source: compiled.source,
        spicePinMapping: compiled.spicePinMapping,
        metadata: compiled.metadata,
        warnings: compiled.warnings,
        sourceEvidence: compiled.sourceEvidence,
      })
      this.assembly.push(
        ...ibisAssembly({ models: [compiled], experiment: scope }).value,
      )
    }
    const warnings = this.models.reduce(
      (count, model) => count + model.warnings.length,
      0,
    )
    this.stats = {
      models: this.models.length,
      probes: this.plan!.probes.length,
      warnings,
    }
    if (this.models.length !== declarations.models.length) return
    const bindings = snapshot<RoutedBindings>({
      circuitJson: this.input.circuitJson,
      scope: this.input.copperScope,
      mappings: this.input.mappings,
      plan: this.plan!,
      nodeMap: declarations.nodes.mapping,
      groundSourcePortId: declarations.nodes.groundSourcePortId,
      electricalLines: this.electricalLines,
      models: this.models,
    })
    const simulationScope = rootScope("simulation").child(
      this.input.artifactPrefix,
    )
    this.artifacts.push(
      scope.json("native-ibis-assembly.json", this.assembly),
      simulationScope.json("electrical-node-map.json", {
        nodes: bindings.nodeMap,
        channelReferenceSourcePortId: bindings.groundSourcePortId,
      }),
    )
    this.output = { value: bindings, artifacts: this.artifacts }
    this.solved = true
  }
  /** Complete immutable bindings only. */
  override getOutput(): Produced<RoutedBindings> {
    if (!this.output) throw new Error("Route bindings are incomplete")
    return this.output
  }
  /** Original input without converter objects. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteBindingsSolver
  > {
    return [this.input]
  }
}
