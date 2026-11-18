import { readFile } from "node:fs/promises"
import type { TestContext } from "node:test"
import type React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../src/board"
import type { RoutedProblem } from "../../src/pipeline"
import { renderCoreSignals } from "./core-render"

/** A rendered fixture board and the copper selected for field checks. */
interface RoutedCopper {
  circuitJson: CircuitJson
  scope: CopperScope
}

/** Real TSX geometry without vendor assets, for pure geometry and field checks. */
export async function routedCopper(): Promise<RoutedCopper> {
  const chips = [
    ["A", -4, 0],
    ["B", 4, 0],
    ["C", -4, 0.35],
    ["D", 4, 0.35],
  ] as const
  const circuitJson = await renderCoreSignals(
    <board
      width={12}
      height={8}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {chips.map(([name, x, y]) => (
        <chip
          key={name}
          name={name}
          pcbX={x}
          pcbY={y}
          pinLabels={{ pin1: "P" }}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                pcbX={0}
                pcbY={0}
                width={0.2}
                height={0.2}
                shape="rect"
              />
            </footprint>
          }
        />
      ))}
      <trace
        from=".A > .P"
        to=".B > .P"
        width={0.1}
        pcbPath={[".A > .P", ".B > .P"]}
      />
      <trace
        from=".C > .P"
        to=".D > .P"
        width={0.1}
        pcbPath={[".C > .P", ".D > .P"]}
      />
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="bottom" unbroken />
    </board>,
  )
  const trace = circuitJson.find((record) => record.type === "source_trace")!
  if (trace.type !== "source_trace") throw new Error("Missing TSX trace")
  const ground = circuitJson.find((record) => record.type === "source_net")!
  if (ground.type !== "source_net") throw new Error("Missing TSX ground")
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuitJson)
  const scope = channelCopperScope({
    circuit: circuitJson,
    connectivity,
    selected: sourceNetMembers(
      connectivity,
      trace.connected_source_port_ids[0],
    ),
    reference: sourceNetMembers(connectivity, ground.source_net_id),
    distanceMm: 1,
  })
  return { circuitJson, scope }
}

/** Explicitly skip unavailable vendor assets; they are never replaced with synthetic native models. */
export async function routedProblem({
  context,
  props = {},
}: {
  context: TestContext
  props?: React.ComponentProps<typeof TwoTraceBoard>
}): Promise<RoutedProblem | undefined> {
  if (!process.env.IBIS_MODEL_DIR) {
    context.skip(
      "Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed",
    )
    return
  }
  let bytes: Buffer
  try {
    bytes = await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    context.skip("Local vendor sn74lvc1g04.ibs is unavailable")
    return
  }
  return {
    circuitJson: await renderCoreSignals(<TwoTraceBoard {...props} />),
    ibisSources: { "models/sn74lvc1g04.ibs": bytes.toString("utf8") },
    scopeDistanceMm: 1,
  }
}
