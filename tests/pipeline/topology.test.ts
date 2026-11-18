import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CircuitJson, selectPort } from "../../src/board"
import {
  signalTopology,
  validateSignalGraph,
} from "../../src/pipeline/topology"
import { driverReceiverChannel } from "../fixtures/driver-receiver-channel"
import {
  crossingRoute,
  daisyChain,
  missingReceiverTerminal,
  padContactRoute,
  platedHoleRoute,
  seriesResistor,
  standaloneViaRoute,
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

test("a linear copper path supports more than one receiver", async () => {
  const circuit = await daisyChain()
  assert.doesNotThrow(() => validate(circuit))
  assert.doesNotThrow(() => validate(circuit, ["MID", "RX"]))
})

test("two copper legs leaving a series resistor form a branch", async () => {
  const straight = await seriesResistor(false)
  assert.doesNotThrow(() => validate(straight))
  const branched = await seriesResistor(true)
  assert.throws(() => validate(branched), /branched routed graphs/)
})

test("a plated hole connects traces on different layers", async () => {
  const circuit = await platedHoleRoute()
  assert.doesNotThrow(() => validate(circuit))
})

test("a standalone via connects traces on different layers", async () => {
  const circuit = await standaloneViaRoute()
  assert.doesNotThrow(() => validate(circuit))
})

test("a same-layer crossing between route vertices forms a junction", async () => {
  const circuit = await crossingRoute()
  assert.throws(() => validate(circuit), /branched routed graphs/)
})

test("a route can reach the receiver pad away from its center", async () => {
  const circuit = await padContactRoute({ offset: 0.14 })
  assert.doesNotThrow(() => validate(circuit))
})

test("trace width contributes to pad contact on its layer", async () => {
  const copperContact = await padContactRoute({ offset: 0.23 })
  assert.doesNotThrow(() => validate(copperContact))
  const gap = await padContactRoute({ offset: 0.3 })
  assert.throws(() => validate(gap), /is not routed between/)
  const otherLayer = await padContactRoute({ offset: 0.14, layer: "bottom" })
  assert.throws(() => validate(otherLayer), /is not routed between/)
})
