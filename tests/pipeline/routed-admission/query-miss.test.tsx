import { test } from "bun:test"
import assert from "node:assert/strict"
import { circuitJsonDb, type SourcePort } from "../../../src/board"
import type { Snapshot } from "../../../src/kernel"
import { snapshot } from "../../../src/kernel"
import { listChannelSimulations } from "../../../src/pipeline/signals"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { renderSignals } from "../../fixtures/signal-render"

test("an absent source port query returns null", async () => {
  const circuit = await renderSignals({
    tree: <AdmissionChannel route="series" />,
  })
  const [channelSimulation] = listChannelSimulations(snapshot(circuit))
  assert.throws(() => {
    // @ts-expect-error Borrowed simulation declarations are readonly.
    channelSimulation.name = "changed"
  }, TypeError)
  const db = circuitJsonDb(snapshot(circuit))
  const port: Snapshot<SourcePort> | null = db.source_port.get("missing")
  const portByName: Snapshot<SourcePort> | null = db.source_port.getWhere({
    name: "missing",
  })
  assert.equal(port, null)
  assert.equal(portByName, null)
})
