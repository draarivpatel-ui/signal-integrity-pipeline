import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { sectionRoutes } from "../../../src/board"
import { measureChordDistanceMm } from "../../../src/board/route-wire"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("reduces sampled curve points within one micrometre of the route", async () => {
  const points = Array.from({ length: 79 }, (_, index) => {
    const x = (index + 1) / 10
    return { x, y: 0.015 * x * (8 - x) }
  })
  const circuit = await renderSectionBoard({
    children: <SectionTrace name="Curve" points={points} />,
  })
  const [trace] = cju(circuit).pcb_trace.list()
  assert(trace.route.length >= points.length + 2)
  const { wires } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  assert(wires.length > 1 && wires.length < points.length / 2)
  for (const point of trace.route) {
    assert.equal(point.route_type, "wire")
    const { x, y } = point
    assert(
      wires.some(
        ({ startPoint, endPoint }) =>
          measureChordDistanceMm({ point: [x, y], startPoint, endPoint }) <=
          0.001,
      ),
    )
  }
})
