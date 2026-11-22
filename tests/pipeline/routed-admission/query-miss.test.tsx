import { test } from "bun:test"
import assert from "node:assert/strict"
import { circuitJsonDb } from "../../../src/board"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { renderSignals } from "../../fixtures/signal-render"

test("an absent source port query returns undefined", async () => {
  const circuit = await renderSignals({
    tree: <AdmissionChannel route="series" />,
  })
  const db = circuitJsonDb(circuit)
  assert.equal(db.source_port.get("missing"), undefined)
  assert.equal(db.source_port.getWhere({ name: "missing" }), undefined)
})
