import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import type { CircuitJsonSnapshot } from "./schema"

/** The board, copper scope and required ports passed to route sectioning. */
export interface RouteSectionsInput {
  readonly circuitJson: CircuitJsonSnapshot
  readonly copperScope: Snapshot<CopperScope>
  readonly requiredSourcePortIds: readonly SourcePortId[]
  readonly referenceSourcePortId: SourcePortId
  readonly artifactPrefix: string
}
