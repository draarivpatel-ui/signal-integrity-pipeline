# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing and pseudo-random binary sequence (PRBS) patterns.
RoutedAdmissionSolver lowers each declared channel simulation into immutable inputs for route sections and buffer binding.
Each routed trace supplies its physical endpoints for electrical cuts. Receiver paths identify which extracted traces lie between each declared driver and receiver.

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
