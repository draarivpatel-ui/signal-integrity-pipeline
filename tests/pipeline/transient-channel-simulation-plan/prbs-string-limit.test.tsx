import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { Inverter, Reference } from "../../fixtures/signal-parts"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

/** Exercise the size check with a finite capture of 600 million bit intervals. */
async function assertPatternLimit(): Promise<void> {
  const circuitJson = await renderSignals({
    tree: (
      <board
        width={18}
        height={12}
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
        <trace
          from=".TX > .Y"
          to=".RX > .A"
          pcbPath={[".TX > .Y", ".RX > .A"]}
        />
        <simulation.pcbtransientchannelsimulation
          bitRate="20Mbps"
          duration="30s"
        >
          <simulation.pcbdriverreceiverchannel
            name="DATA"
            driverRef=".TX > .Y"
            receiverRef=".RX > .A"
            pattern="prbs31"
            seed={1}
          />
        </simulation.pcbtransientchannelsimulation>
      </board>
    ),
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), /prbs31 pattern exceeds .* bits/)
}

if (process.argv.includes("--verify-pattern")) await assertPatternLimit()
else
  test.failing(
    "rejects a PRBS string that exceeds the runtime representation",
    async () => {
      // Bound the run on the unfixed solver so it cannot build the full string.
      const subprocess = Bun.spawn(
        [process.execPath, "run", import.meta.path, "--verify-pattern"],
        {
          timeout: 700,
          stderr: "pipe",
        },
      )
      const [stderr, exitCode] = await Promise.all([
        new Response(subprocess.stderr).text(),
        subprocess.exited,
      ])
      assert.equal(exitCode, 0, stderr)
    },
  )
