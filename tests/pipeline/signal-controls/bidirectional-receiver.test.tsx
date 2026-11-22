import { test } from "bun:test"
import assert from "node:assert/strict"
import { endpointPorts } from "../../../src/pipeline/signals"
import { ParallelBus, parallelBusSources } from "../../fixtures/parallel-bus"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("a bidirectional DQ declared as a receiver does not drive the net", async () => {
  const circuit = await renderSignals({
    tree: <ParallelBus nearbyDriverPattern="0" />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: parallelBusSources,
  })
  const [port] = endpointPorts(prepared.driverReceiverChannels[0].receivers[0])
  assert.equal(prepared.pins.get(port)?.buffer.type, "i/o")
  const { states, stimuli } =
    prepared.controls[
      prepared.channelSimulation.simulation_pcb_transient_channel_simulation_id
    ]
  assert.deepEqual(
    states.find((state) => state.source_port_id === port),
    {
      source_port_id: port,
      is_output: false,
    },
  )
  assert.equal(
    stimuli.some((stimulus) => stimulus.source_port_id === port),
    false,
  )
})
