## What is it?

Signal-integrity tools for tscircuit boards.

## How to use it?

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.

## General workflow

```mermaid
flowchart LR
  input["Circuit JSON validation"] --> result["Stackup and stimulus helpers"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: Stackup and stimulus helpers
  Ready --> Failed: invalid input
  Complete --> [*]
  Failed --> [*]
```
