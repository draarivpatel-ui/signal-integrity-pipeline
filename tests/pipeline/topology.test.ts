import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CircuitJson, selectPort } from "../../src/board"
import {
  signalTopology,
  validateSignalGraph,
} from "../../src/pipeline/topology"
import { driverReceiverChannel } from "../fixtures/driver-receiver-channel"
import {
  missingReceiverTerminal,
  unroutedExtraPin,
} from "../fixtures/topology-board"

/** Validate a channel between the named test pins on a rendered board. */
function validate(circuit: CircuitJson, receivers: string[] = ["RX"]): void {
  const driver = selectPort(circuit, { component: "TX", port: "SIG" })
  const signal = driverReceiverChannel({ pattern: "01", bitRateBps: 1e9 })
  signal.driver = { source_port_id: driver.source_port_id }
  signal.receivers = receivers.map((component) => ({
    source_port_id: selectPort(circuit, { component, port: "SIG" })
      .source_port_id,
  }))
  const rails = new Set<string>()
  validateSignalGraph({
    circuit,
    signalConnectivity: signalTopology({ circuit, rails }),
    signals: [signal],
    rails,
    allowUnroutedTraces: false,
  })
}

test("a receiver without a PCB terminal cannot inherit the driver terminal", async () => {
  const circuit = await missingReceiverTerminal()
  assert.throws(
    () => validate(circuit),
    /is not routed between source_port_0 and source_port_1/,
  )
})

test("an unrouted same-net pin outside the channel does not block its routed receiver", async () => {
  const circuit = await unroutedExtraPin()
  assert.doesNotThrow(() => validate(circuit))
  assert.throws(
    () => validate(circuit, ["STUB"]),
    /is not routed between source_port_0 and source_port_2/,
  )
})
