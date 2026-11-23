# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing, pseudo-random binary sequence (PRBS) patterns and declared aggressor states.

```mermaid
flowchart LR
  input["Channel declarations"] --> result["Signal checks, pin selection and aggressor admission"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: Signal checks, pin selection and aggressor admission
  Ready --> Failed: invalid input or undeclared aggressors
  Complete --> [*]
  Failed --> [*]
```
