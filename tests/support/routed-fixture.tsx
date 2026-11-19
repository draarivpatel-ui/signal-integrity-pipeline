import type React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { RoutedProblem } from "../../src/pipeline"
import { renderCoreSignals } from "./core-render"
import { vendorText } from "./vendor-models"

/** Loads the real routed input for tests requiring the vendor model. */
export async function routedProblem({
  props = {},
}: {
  props?: React.ComponentProps<typeof TwoTraceBoard>
} = {}): Promise<RoutedProblem> {
  const text = await vendorText("sn74lvc1g04.ibs")
  return {
    circuitJson: await renderCoreSignals(<TwoTraceBoard {...props} />),
    ibisSources: { "models/sn74lvc1g04.ibs": text },
    scopeDistanceMm: 1,
  }
}
