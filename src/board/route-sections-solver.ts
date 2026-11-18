import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import type { CircuitJson } from "./schema"

export interface RouteSectionsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  requiredSourcePortIds: SourcePortId[]
  referenceSourcePortId: SourcePortId
  artifactPrefix: string
}
