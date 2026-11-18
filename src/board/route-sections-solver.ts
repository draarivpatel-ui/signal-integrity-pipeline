import type { CopperScope } from "./geometry/scope"
import type { CircuitJson } from "./schema"

export interface RouteSectionsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  requiredSourcePortIds: string[]
  referenceSourcePortId: string
  artifactPrefix: string
}
