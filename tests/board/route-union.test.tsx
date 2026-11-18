import { test } from "bun:test"
import assert from "node:assert/strict"
import type React from "react"
import {
  type CircuitJson,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  segmentRoutes,
  sourceNetMembers,
} from "../../src/board"
import { RouteFieldsSolver } from "../../src/extraction"
import { renderCoreSignals } from "../support/core-render"

/** Two same-net strips meet exactly at their edges, as on the board's DDR power rail. */
function TouchingRail({
  "same-net": sameNet = true,
}: {
  "same-net"?: boolean
}): React.JSX.Element {
  return (
    <board
      width={8}
      height={5}
      layers={2}
      thickness={0.4}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {["A", "B", "C", "D"].map((name, i) => (
        <chip
          key={name}
          name={name}
          pcbX={i % 2 ? 2 : -2}
          pcbY={i < 2 ? 0 : 0.3}
          pinLabels={{ pin1: "P" }}
          connections={{ P: i < 2 || sameNet ? "net.RAIL" : "net.OTHER" }}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                pcbX={0}
                pcbY={0}
                width={0.15}
                height={0.15}
                shape="rect"
              />
            </footprint>
          }
        />
      ))}
      <trace
        from=".A > .P"
        to=".B > .P"
        width={0.3}
        pcbPath={[".A > .P", ".B > .P"]}
      />
      <trace
        from=".C > .P"
        to=".D > .P"
        width={0.3}
        pcbPath={[".C > .P", ".D > .P"]}
      />
      <net name="RAIL" />
      <net name="OTHER" />
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="bottom" unbroken />
    </board>
  )
}

test("TSX touching same-net rail strips form one physical conductor before extraction", async () => {
  const circuit = await renderCoreSignals(<TouchingRail />)
  const rail = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "RAIL")!
  const ground = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "GND")!
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const scope = channelCopperScope({
    circuit,
    connectivity,
    selected: sourceNetMembers(connectivity, rail.source_net_id),
    reference: sourceNetMembers(connectivity, ground.source_net_id),
  })
  const geometry = segmentRoutes(circuit, scope)
  assert.ok(
    geometry.wires.some(
      (wire) => Math.abs(wire.width - 0.6) < 1e-7 && wire.joins?.length,
    ),
  )
  const materials = {
    maskMm: 0,
    maskEr: 1,
    maskLoss: 0,
    substrateLoss: 0,
  }
  assert.doesNotThrow(() => {
    const solver = new RouteFieldsSolver({
      geometry,
      materials,
      artifactPrefix: "test",
    })
    solver.solve()
    return solver.getOutput().value
  })
  const board = <TouchingRail same-net={false} />
  const separate = await renderCoreSignals(board).catch(
    (error: Error & { circuitJson: CircuitJson }) => {
      const errors = error.circuitJson.filter((record) =>
        record.type.endsWith("_error"),
      )
      assert.ok(errors.some((record) => record.type === "pcb_trace_error"))
      assert.ok(
        errors.every((record) => {
          return (
            record.type === "pcb_trace_error" ||
            record.type === "pcb_pad_trace_clearance_error"
          )
        }),
      )
      return error.circuitJson
    },
  )

  const touching = segmentRoutes(separate, scope)
  assert.throws(
    () => {
      const solver = new RouteFieldsSolver({
        geometry: touching,
        materials,
        artifactPrefix: "test",
      })
      solver.solve()
      return solver.getOutput().value
    },
    /Signal rectangles overlap or touch/,
    "touching different nets remain an explicit failure",
  )
})
