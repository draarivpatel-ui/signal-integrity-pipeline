import { readFile } from "node:fs/promises"
import type { TestContext } from "node:test"
import type React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { RoutedProblem } from "../../src/pipeline"
import { renderCoreSignals } from "./core-render"

/** Explicitly skip unavailable vendor assets; they are never replaced with synthetic native models. */
export async function routedProblem(
  context: TestContext,
  props: React.ComponentProps<typeof TwoTraceBoard> = {},
): Promise<RoutedProblem | undefined> {
  if (!process.env.IBIS_MODEL_DIR) {
    context.skip(
      "Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed",
    )
    return
  }
  let bytes: Buffer
  try {
    bytes = await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    context.skip("Local vendor sn74lvc1g04.ibs is unavailable")
    return
  }
  return {
    circuitJson: await renderCoreSignals(<TwoTraceBoard {...props} />),
    ibisSources: { "models/sn74lvc1g04.ibs": bytes.toString("utf8") },
    scopeDistanceMm: 1,
  }
}
