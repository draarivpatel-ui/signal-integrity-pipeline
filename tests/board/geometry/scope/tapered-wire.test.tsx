import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

/** Keep the wide pad itself beyond the scope while its teardrop reaches it. */
const END_PAD_X_MM = 4.6

test("a tapered wire is admitted when its widest copper reaches the scope", async () => {
  for (const pcbTeardropEnd of [false, true]) {
    const circuit = await renderCoreSignals(
      <board width={24} height={18} routeRemaining={false} schematicDisabled>
        <Wire name="SELECTED" y={0} extent={3} />
        <Wire
          name="TAPER"
          y={1.35}
          extent={END_PAD_X_MM}
          pcbTeardropEnd={pcbTeardropEnd}
          endPad={
            <smtpad
              portHints={["pin2"]}
              pcbX={END_PAD_X_MM}
              pcbY={0}
              width={1.125}
              height={1.125}
              shape="rect"
            />
          }
        />
      </board>,
    )
    const trace = scopeTrace({ circuit, name: "TAPER" })
    const wire = trace.route.filter((point) => point.route_type === "wire")
    assert(wire.every((point) => point.width === 0.1))
    assert.equal(
      wire.some((point) => point.end_width === 0.9),
      pcbTeardropEnd,
    )
    assert.equal(
      scopeFor({ circuit }).extractedPcbTraceIds.includes(trace.pcb_trace_id),
      pcbTeardropEnd,
    )
  }
})
