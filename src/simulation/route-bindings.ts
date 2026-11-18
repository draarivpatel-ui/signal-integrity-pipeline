import { BaseSolver } from "@tscircuit/solver-utils"
import {
  type AdmittedBuffers,
  type AssemblyEntry,
  admitBuffers,
  compileBuffers,
  ibisAssembly,
} from "../buffers"
import { type Artifact, type Produced, rootScope, snapshot } from "../kernel"
import { generalDeclarations, modelRunDefinition } from "./declarations"
import { electricalSources } from "./netlist"
import type {
  RouteBindingsInput,
  RouteBuffer,
  RoutedBindings,
} from "./routed-types"
import type { Declarations, SimulationPlan } from "./types"

/** Bind one vendor buffer per step; electrical names retain source-record order. */
export class RouteBindingsSolver extends BaseSolver {
  private declarations?: Declarations
  private admitted?: AdmittedBuffers
  private plan?: SimulationPlan
  private electricalLines: string[] = []
  private readonly models: RouteBuffer[] = []
  private readonly assembly: AssemblyEntry[] = []
  private readonly artifacts: Artifact[] = []
  private output?: Produced<RoutedBindings>
  /** Inputs contain domain intent, never another stage's internals. */
  constructor(private readonly input: RouteBindingsInput) {
    super()
  }
  /** Cut physical copper out of ideal connectivity, then compile one original IBIS model. */
  override _step(): void {
    const scope = rootScope("buffers").child(this.input.artifactPrefix)
    if (!this.declarations) {
      const mappings = structuredClone(this.input.mappings)
      if (!mappings.length)
        throw new Error("Routed compilation requires physical signal mappings")
      mappings[0].sourceTraceIds = this.input.circuitJson
        .filter((record) => record.type === "pcb_trace")
        .filter(
          (trace) =>
            this.input.scope.pcbTraceIds.includes(trace.pcb_trace_id) &&
            !this.input.scope.nonReferenceRailTraceIds.includes(
              trace.pcb_trace_id,
            ),
        )
        .map((trace) => trace.source_trace_id!)
      this.declarations = generalDeclarations({
        circuit: this.input.circuitJson,
        mappings,
        modeling: this.input.modeling,
        controls: this.input.controls,
      })
      this.plan = this.declarations.plans[0]
      this.plan.durationSeconds = this.input.options.durationSeconds
      this.plan.maxStepSeconds = this.input.options.stepSeconds
      this.electricalLines = electricalSources(
        this.input.circuitJson,
        this.input.modeling,
        this.declarations.nodes,
      ).lines
      const admitted = admitBuffers({
        models: this.declarations.models,
        ibisSources: this.input.ibisSources,
        scope,
      })
      this.admitted = admitted.value
      this.artifacts.push(...admitted.artifacts)
    }
    const model = this.declarations.models[this.models.length]
    if (model) {
      const [compiled] = compileBuffers(
        this.admitted!,
        [{ ...this.plan!, models: [model] }],
        modelRunDefinition,
      )[0]
      this.models.push({
        name: compiled.name,
        source: compiled.source,
        spicePinMapping: compiled.spicePinMapping,
        metadata: compiled.metadata,
        warnings: compiled.warnings,
        sourceEvidence: compiled.sourceEvidence,
      })
      this.assembly.push(...ibisAssembly([compiled], scope).value)
    }
    this.stats = {
      models: this.models.length,
      probes: this.plan!.probes.length,
      warnings: this.models.reduce((n, model) => n + model.warnings.length, 0),
    }
    if (this.models.length !== this.declarations.models.length) return
    const bindings = snapshot({
      circuitJson: this.input.circuitJson,
      scope: this.input.scope,
      mappings: this.input.mappings,
      plan: this.plan!,
      nodeMap: this.declarations.nodes.mapping,
      groundSourcePortId: this.declarations.nodes.groundSourcePortId,
      electricalLines: this.electricalLines,
      models: this.models,
    })
    this.artifacts.push(
      scope.json("native-ibis-assembly.json", this.assembly),
      rootScope("simulation")
        .child(this.input.artifactPrefix)
        .json("electrical-node-map.json", {
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
  override getConstructorParams(): [RouteBindingsInput] {
    return [this.input]
  }
}
