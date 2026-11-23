import { test } from "bun:test"
import assert from "node:assert/strict"
import { Circuit as LegacyCircuit } from "@tscircuit/core-legacy"
import { validateCircuitRecords } from "../../../src/board"
import { renderCoreSignals } from "../../support/core-render"

test("accepts canonical inductance and diagnoses a legacy core unit string", async () => {
  const board = (
    <board schematicDisabled>
      <inductor name="L_PWR3" inductance="1.5uH" footprint="0402" />
    </board>
  )
  const legacyCircuit = new LegacyCircuit({
    platform: { partsEngineDisabled: true },
  })
  legacyCircuit.add(board)
  await legacyCircuit.renderUntilSettled()
  assert.throws(() => validateCircuitRecords(legacyCircuit.getCircuitJson()), {
    code: "circuit_schema",
    message:
      'circuit_schema: source_component L_PWR3: inductance: expected number 0.0000015 (canonical Circuit JSON), got "1.5uH"',
  })
  const circuit = await renderCoreSignals(board)
  assert.doesNotThrow(() => validateCircuitRecords(circuit))
})
