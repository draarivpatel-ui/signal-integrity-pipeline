import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a rotated plated pad reaches a bottom-layer channel on a four-layer board", async () => {
  const circuit = await renderCoreSignals(
    <board
      width={18}
      height={18}
      layers={4}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} layer="bottom" />
      <chip
        name="ROTATED"
        pcbY={2.5}
        pcbRotation={90}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <platedhole
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              shape="hole_with_polygon_pad"
              holeShape="circle"
              holeDiameter={0.3}
              holeOffsetX={0}
              holeOffsetY={0}
              padOutline={[
                { x: -1.6, y: -0.2 },
                { x: 1.6, y: -0.2 },
                { x: 1.6, y: 0.2 },
                { x: -1.6, y: 0.2 },
              ]}
            />
          </footprint>
        }
      />
    </board>,
  )
  const pad = circuit.find((record) => record.type === "pcb_plated_hole")
  assert(pad?.shape === "hole_with_polygon_pad")
  assert.equal(pad.ccw_rotation, 90)
  assert(pad.layers.includes("top"))
  assert(pad.layers.includes("bottom"))
  assert(pad.pcb_port_id)
  const port = circuit.find(
    (record) =>
      record.type === "pcb_port" && record.pcb_port_id === pad.pcb_port_id,
  )
  assert(port)
  assert(scopeFor({ circuit }).retainedSourceIds.includes(port.source_port_id))
})
