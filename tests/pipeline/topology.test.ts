import { test } from "bun:test"
import assert from "node:assert/strict"
import type { SourceNetId, SourcePortId } from "../../src/board"
import {
  signalTopology,
  validateSignalGraph,
} from "../../src/pipeline/topology"
import {
  crossingRoute,
  daisyChain,
  differentialTerminationRoute,
  missingReceiverTerminal,
  padContactRoute,
  platedHoleRoute,
  seriesResistor,
  standaloneViaRoute,
  type TopologyBoard,
  unroutedExtraPin,
} from "../fixtures/topology-board"

/** Validate the declared channel against the rendered copper under the pipeline's strict routing policy. */
function validate({ circuit, signal }: TopologyBoard): void {
  const rails = new Set<SourcePortId | SourceNetId>()
  validateSignalGraph({
    circuit,
    signalConnectivity: signalTopology({ circuit, rails }),
    signals: [signal],
    rails,
    allowUnroutedTraces: false,
  })
}

test("a receiver without a PCB terminal cannot inherit the driver terminal", async () => {
  const board = await missingReceiverTerminal()
  assert.throws(
    () => validate(board),
    /is not routed between source_port_0 and source_port_1/,
  )
})

test("an unrouted same-net pin outside the channel does not block its routed receiver", async () => {
  const board = await unroutedExtraPin("RX")
  assert.doesNotThrow(() => validate(board))
})

test("an unrouted declared receiver is rejected", async () => {
  const board = await unroutedExtraPin("STUB")
  assert.throws(
    () => validate(board),
    /is not routed between source_port_0 and source_port_2/,
  )
})

test("a linear copper path can pass through an undeclared intermediate pin", async () => {
  const board = await daisyChain(["RX"])
  assert.doesNotThrow(() => validate(board))
})

test("a linear copper path supports more than one receiver", async () => {
  const board = await daisyChain(["MID", "RX"])
  assert.doesNotThrow(() => validate(board))
})

test("a routed path can cross a series resistor", async () => {
  const straight = await seriesResistor(false)
  assert.doesNotThrow(() => validate(straight))
})

test("two copper legs leaving a series resistor form a branch", async () => {
  const branched = await seriesResistor(true)
  assert.throws(() => validate(branched), /branched routed graphs/)
})

test("a plated hole connects traces on different layers", async () => {
  const board = await platedHoleRoute()
  assert.doesNotThrow(() => validate(board))
})

test("a standalone via connects traces on different layers", async () => {
  const board = await standaloneViaRoute()
  assert.doesNotThrow(() => validate(board))
})

test("a same-layer crossing between route vertices forms a junction", async () => {
  const board = await crossingRoute()
  assert.throws(() => validate(board), /branched routed graphs/)
})

test("a route can reach the receiver pad away from its center", async () => {
  const board = await padContactRoute({ offset: 0.14 })
  assert.doesNotThrow(() => validate(board))
})

test("trace width contributes to pad contact on its layer", async () => {
  const copperContact = await padContactRoute({ offset: 0.23 })
  assert.doesNotThrow(() => validate(copperContact))
})

test("a gap between trace copper and the receiver pad leaves the receiver unrouted", async () => {
  const gap = await padContactRoute({ offset: 0.3 })
  assert.throws(() => validate(gap), /is not routed between/)
})

test("trace copper cannot connect to a pad on a different layer", async () => {
  const otherLayer = await padContactRoute({ offset: 0.14, layer: "bottom" })
  assert.throws(() => validate(otherLayer), /is not routed between/)
})

test("a cross-leg termination load leaves both differential paths linear", async () => {
  const board = await differentialTerminationRoute()
  assert.doesNotThrow(() => validate(board))
})
