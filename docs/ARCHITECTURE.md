# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing, pseudo-random binary sequence (PRBS) patterns and declared aggressor states.
RoutedAdmissionSolver lowers each declared channel simulation into immutable inputs for route sections and buffer binding.
Ideal wires, named nets and internal pin ties form the source groups used by SPICE.
A named net can span the cuts connecting its own contacts without absorbing an unlabeled branch.
Admission and binding use the same receiver graph. Its paths traverse ideal junctions, physical cuts and series passives. Rail shunts and differential terminations stay outside those paths.
Each cut keeps both physical contacts. Binding checks their selected models, detects signal contacts tied to ground, and distinguishes routed loops from ideal bypasses.

```mermaid
flowchart LR
  board["Circuit JSON and channel declarations"] --> prepare["Prepare channel and aggressor states"]
  ibis["IBIS sources"] --> prepare
  prepare --> cuts["Find physical trace cuts"]
  cuts --> groups["Group ideal source contacts"]
  groups --> paths["Map ordered driver-to-receiver paths"]
  cuts --> sections["Route sectioning inputs"]
  paths --> bindings["Binding inputs for contact and short checks"]
  paths --> manifest["Admission manifest"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: RoutedAdmissionSolver
  Ready --> Failed: invalid input or undeclared aggressors
  Complete --> [*]
  Failed --> [*]
```
