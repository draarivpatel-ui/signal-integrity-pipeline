import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { simulation } from "@tscircuit/core"
import React from "react"
import { Inverter, Reference } from "./signal-parts"
import { prepareBlocks, renderSignals } from "./signal-render"

/** The unmodelled three-pad copper is physically far from DATA, on the same real board. */
function Board({
  unrelatedY = 20,
  neighbour = false,
}: {
  unrelatedY?: number
  neighbour?: boolean
}): React.JSX.Element {
  return (
    <board
      width={24}
      height={60}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      <Inverter name="TX" x={-5} y={0} driver />
      <Inverter name="RX" x={5} y={0} driver={false} />
      <Reference />
      {neighbour && (
        <>
          <Inverter name="QUIET_TX" x={-5} y={0.8} driver />
          <Inverter name="QUIET_RX" x={5} y={0.8} driver={false} />
          <trace
            from=".QUIET_TX > .Y"
            to=".QUIET_RX > .A"
            width={0.2}
            pcbPath={[".QUIET_TX > .Y", ".QUIET_RX > .A"]}
          />
        </>
      )}
      <trace
        from=".TX > .Y"
        to=".RX > .A"
        width={0.2}
        pcbPath={[".TX > .Y", ".RX > .A"]}
      />
      <chip
        name="UNRELATED"
        pcbY={unrelatedY}
        pinLabels={{ pin1: "A", pin2: "B", pin3: "C" }}
        footprint={
          <footprint>
            {[1, 2, 3].map((pin) => (
              <React.Fragment key={pin}>
                <smtpad
                  portHints={[`pin${pin}`]}
                  pcbX={pin}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </React.Fragment>
            ))}
          </footprint>
        }
      />
      <trace
        path={[".UNRELATED > .A", ".UNRELATED > .B", ".UNRELATED > .C"]}
        width={0.2}
        pcbPaths={[
          [".UNRELATED > .A", ".UNRELATED > .B"],
          [".UNRELATED > .B", ".UNRELATED > .C"],
        ]}
      />
      <pcbnotetext
        text="DATA at y=0; unrelated branched copper at y=20 mm"
        pcbY={25}
        pcbX={0}
      />
      <simulation.pcbtransientchannelsimulation name="SCOPED" bitRate="20Mbps">
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef=".TX > .Y"
          receiverRef=".RX > .A"
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

const modelDir = process.env.IBIS_MODEL_DIR

test(
  "unrelated branched copper cannot reject a selected channel",
  { skip: !modelDir },
  async () => {
    const circuit = await renderSignals(<Board />)
    const sources = {
      "models/sn74lvc1g04.ibs": await readFile(`${modelDir}/sn74lvc1g04.ibs`),
    }
    const [block] = prepareBlocks({ circuit, sources, distanceMm: 1 })
    assert.equal(block.settings.lanes.length, 1)
    assert.equal(block.settings.copperScope?.omitted.traces, 2)
    const near = prepareBlocks({
      circuit: await renderSignals(<Board neighbour />),
      sources,
      distanceMm: 1,
    })[0]
    assert.equal(
      near.settings.lanes.length,
      1,
      "only the selected channel is a lane",
    )
    const { pcbTraceIds, selectedPcbTraceIds } = near.settings.copperScope
    assert.ok(
      pcbTraceIds.length > selectedPcbTraceIds.length,
      "the nearby quiet conductor stays in the copper scope",
    )
    const quiet = [...near.pins.values()].find((pin) => {
      if (pin.buffer.type !== "output") return false
      return !near.signals.some(
        ({ driver }) =>
          "source_port_id" in driver && driver.source_port_id === pin.port,
      )
    })!
    const { stimuli } =
      near.controls[near.block.simulation_pcb_transient_channel_simulation_id]
    const quietStimulus = stimuli.some((stimulus) => {
      return (
        stimulus.source_port_id === quiet.port &&
        stimulus.transmission_pattern.bits === "0"
      )
    })
    assert.ok(quietStimulus)
    const nearbyBranch = await renderSignals(<Board unrelatedY={0.5} />)
    const branched = prepareBlocks({
      circuit: nearbyBranch,
      sources,
      distanceMm: 1,
    })[0]
    assert.equal(
      branched.settings.lanes.length,
      1,
      "nearby branched copper is a scoped neighbour, not a rejected lane",
    )
    assert.ok(
      branched.settings.copperScope.pcbTraceIds.length >
        branched.settings.copperScope.selectedPcbTraceIds.length,
    )
  },
)
