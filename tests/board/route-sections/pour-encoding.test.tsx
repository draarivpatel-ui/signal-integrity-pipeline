import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import type { PcbCopperPour } from "circuit-json"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("sections equivalent rectangular, polygon and BRep reference pours", async () => {
  const circuit = await renderSectionBoard({
    children: <SectionTrace name="Signal" />,
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const { brep_shape, ...pourFields } = pour
  const points = brep_shape.outer_ring.vertices
  const minX = Math.min(...points.map(({ x }) => x))
  const maxX = Math.max(...points.map(({ x }) => x))
  const minY = Math.min(...points.map(({ y }) => y))
  const maxY = Math.max(...points.map(({ y }) => y))
  const alternatives: PcbCopperPour[] = [
    { ...pourFields, shape: "polygon", points },
    {
      ...pourFields,
      shape: "rect",
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
    },
    pour,
  ]
  for (const replacement of alternatives) {
    const board = circuit.map((record) =>
      record === pour ? replacement : record,
    )
    const { sections } = sectionRoutes({
      circuit: board,
      copperScope: getSectionInput({ circuit: board }).copperScope,
    })
    assert.deepEqual(
      sections.map(({ startMm, endMm, references }) => [
        startMm,
        endMm,
        references[0].pcbCopperPourId,
      ]),
      [[-4, 4, pour.pcb_copper_pour_id]],
    )
  }
})
