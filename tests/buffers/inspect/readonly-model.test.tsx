import { test } from "bun:test"
import assert from "node:assert/strict"
import { circuitJsonDb } from "../../../src/board"
import { inspectPins } from "../../../src/buffers"
import { snapshot } from "../../../src/kernel"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test.failing(
  "pin inspection exposes the borrowed IBIS declaration as readonly",
  async () => {
    const circuit = snapshot(
      await renderSignals({ tree: <AdmissionChannel route="series" /> }),
    )
    const [{ driver }] =
      circuitJsonDb(circuit).simulation_pcb_driver_receiver_channel.list()
    assert.ok("source_port_id" in driver)
    const pins = inspectPins({
      circuit,
      sources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
      ports: new Set([driver.source_port_id]),
    })
    const pin = pins.get(driver.source_port_id)
    assert.ok(pin)
    const [{ pins: preparedPins }] = prepareChannelSimulations({
      circuit: await renderSignals({
        tree: <AdmissionChannel route="series" />,
      }),
      sources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
    })
    const preparedPin = preparedPins.get(driver.source_port_id)
    assert.ok(preparedPin)
    assert.equal(
      Reflect.set(pin.model, "ibis_component_name", "changed"),
      false,
    )
    assert.equal(
      Reflect.set(preparedPin.model, "ibis_component_name", "changed"),
      false,
    )
  },
)
