import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { renderCoreSignals } from "../../support/core-render"

test.failing(
  "a referenced ZIP fails with the shared IBIS diagnostic during admission",
  async () => {
    const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])
    const solver = new RoutedAdmissionSolver({
      circuitJson,
      ibisSources: { "models/sn74lvc1g04.ibs": zipBytes },
    })
    assert.throws(() => solver.step(), {
      domain: "buffers",
      code: "ibis_asset",
      message: /extract ZIP archives/,
    })
    assert.equal(solver.failed, true)
  },
)
