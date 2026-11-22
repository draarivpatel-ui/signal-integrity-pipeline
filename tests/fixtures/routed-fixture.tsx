import type React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { RoutedAdmissionInput } from "../../src/pipeline"
import { renderCoreSignals } from "../support/core-render"
import { loadVendorModel, vendorModels } from "./vendor-models"

export const inverterModelPath = "models/sn74lvc1g04.ibs"

/** Load the locked vendor bytes and the board used in routed pipeline tests. */
export async function routedProblem({
  props = {},
}: {
  props?: React.ComponentProps<typeof TwoTraceBoard>
} = {}): Promise<RoutedAdmissionInput> {
  return {
    circuitJson: await renderCoreSignals(<TwoTraceBoard {...props} />),
    ibisSources: {
      [inverterModelPath]: await loadVendorModel(vendorModels.cmos),
    },
    scopeDistanceMm: 1,
  }
}
