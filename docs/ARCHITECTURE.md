# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing and pseudo-random binary sequence (PRBS) patterns.
RoutedAdmissionSolver lowers each declared channel simulation into immutable inputs for route sections and buffer binding.
Ideal wires, named nets and internal pin ties form the source groups used by SPICE.
Receiver paths traverse those groups through physical trace cuts and series components.
Each cut keeps both physical contacts for sectioning even when one contact shares an ideal node with another cut.

```mermaid
flowchart LR
  input["Channel declarations"] --> result["RoutedAdmissionSolver"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: RoutedAdmissionSolver
  Ready --> Failed: invalid input
  Complete --> [*]
  Failed --> [*]
```
