import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("rectangular plated pads do not extend the scope to distant nets", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire
        name="SELECTED"
        y={0}
        extent={3}
        startPad={
          <platedhole
            portHints={["pin1"]}
            pcbX={-3}
            pcbY={0}
            shape="circular_hole_with_rect_pad"
            holeDiameter={0.25}
            rectPadWidth={0.6}
            rectPadHeight={0.6}
          />
        }
      />
      <Wire name="DISTANT" y={5} extent={3} />
    </board>,
  )
  assert.equal(scopeFor({ circuit }).pcbTraceIds.length, 1)
})
