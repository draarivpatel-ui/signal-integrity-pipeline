import { test } from "bun:test"
import assert from "node:assert/strict"
import { validateCircuitRecords } from "../../../src/board"
import { renderCoreSignals } from "../../support/core-render"

test.failing(
  "rejects a rendered inductor with a noncanonical inductance",
  async () => {
    const circuit = await renderCoreSignals(
      <board schematicDisabled>
        <inductor name="L_PWR3" inductance="1.5uH" footprint="0402" />
      </board>,
    )
    assert.throws(() => validateCircuitRecords(circuit), {
      code: "circuit_schema",
      message:
        'circuit_schema: source_component L_PWR3: inductance: expected number 0.0000015 (canonical Circuit JSON), got "1.5uH"',
    })
  },
)
