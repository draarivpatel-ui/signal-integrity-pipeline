# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing, pseudo-random binary sequence (PRBS) patterns and declared aggressor states.
TransientChannelSimulationPlanSolver lowers each declared channel simulation into immutable inputs for copper geometry extraction and buffer binding.
Ideal wires, named nets and internal pin ties form the source groups used by SPICE.
A named net can span the extracted traces connecting its own contacts, including multipoint ideal junctions.
Channel planning and binding use the same receiver graph. Its paths traverse ideal junctions, extracted traces and series passives.
Rail shunts and differential terminations stay outside those paths, including terminations attached by both copper and ideal wires.
Each extracted trace keeps both physical contacts. Binding checks their selected models and detects signal contacts tied to ground.
Removing an extracted trace or series passive from the receiver graph must disconnect its two ends.
An alternate path reports the physical contacts and distinguishes an entirely routed loop from a bypass through ideal wiring.
`CopperGeometryExtractionSolver` models scoped traces, vias, reference pours, and pad contacts. It groups wires into sections with consistent nearby copper and reference surfaces.

RouteFieldsSolver maps each routed section to its electrical coefficients and screens nearby pairs for coupling.

```mermaid
flowchart LR
  board["Circuit JSON and channel declarations"] --> prepare["Prepare channel and aggressor states"]
  ibis["IBIS sources"] --> prepare
  prepare --> traces["Identify extracted trace contacts"]
  traces --> groups["Group ideal source contacts"]
  groups --> paths["Map ordered driver-to-receiver paths"]
  traces --> geometry["CopperGeometryExtractionSolver"]
  geometry --> routeFields["RouteFieldsSolver"]
  paths --> bindings["Binding inputs"]
  bindings --> checks["Check contacts and alternate paths around each segment"]
  paths --> manifest["Transient channel simulation plan manifest"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Planned: TransientChannelSimulationPlanSolver
  Planned --> GeometryReady: CopperGeometryExtractionSolver
  GeometryReady --> Complete: RouteFieldsSolver
  GeometryReady --> Failed: invalid field geometry or inputs
  Planned --> Failed: missing required contact or reference, unsupported route or soldermask
  Ready --> Failed: invalid input, conflicting IBIS model selections or undeclared aggressors
  Complete --> [*]
  Failed --> [*]
```

## 2D RLGC calculation

The internal `calculateRlgc` function in `src/rlgc/` calculates the per-unit-length matrices in input conductor order.
Capacitance (with dielectrics and in vacuum) is in F/m, external inductance is in H/m and DC resistance is in Ω/m.
For frequency `f` in Hz, multiply the dielectric loss coefficient (F/m) by `2πf` for conductance in S/m.
Multiply the skin resistance coefficient (Ω/m/√Hz) by `√f` for the high-frequency skin contribution in Ω/m.
The calculation also returns the conductor-only skin coefficient, obtained with fixed reference planes.

Interfaces in a half-space extend by the requested number of cross-section spans. Between two reference planes, padding is measured in the lateral field decay length (plane spacing divided by π). Each shielded region is limited to 3072 boundary panels before dense matrix allocation.

```mermaid
flowchart LR
  crossSection["Cross-section geometry"] --> panels["Plan and build boundary panels"]
  panels --> fields["Calculate electrostatic fields and loss coefficients"]
  fields --> matrices["Check reciprocity and passivity"]
  matrices --> coefficients["Per-unit-length matrices"]
```

```mermaid
stateDiagram-v2
  [*] --> CrossSectionReady
  CrossSectionReady --> Meshed: valid geometry and panel budget
  CrossSectionReady --> CalculationFailed: invalid geometry, options or panel budget
  Meshed --> CoefficientsReady: finite, reciprocal and passive matrices
  Meshed --> CalculationFailed: singular, nonfinite, nonreciprocal or nonpassive matrices
  CoefficientsReady --> [*]
  CalculationFailed --> [*]
```

The native adapter waits for the executable to exit. The legacy caller-specified timeout and its dedicated diagnostic were removed. IBIS source validation continues to check paths and reject non-IBIS data. The previous byte-size limit was removed.
