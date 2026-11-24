import "graphics-debug/matcher"
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  getCopperExtractionInput,
  renderCopperGeometryBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/copper-geometry-board"

test("keeps a pad contact beyond the end of a simplified chord", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <SectionTrace
          name="Signal"
          startX={0}
          endX={4}
          points={[{ x: -0.0008, y: 0 }]}
        />
        <SectionPin name="Overhang" x={-0.3004} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperExtractionInput({ circuit, required: ["Overhang"] }),
  )
  solver.solve()
  const { wires, portContacts } = solver.getOutput().value.geometry
  assert.equal(wires.length, 1)
  assert.deepEqual(wires[0].startPoint, [0, 0])
  assert.equal(wires[0].startTouchesPort, true)
  assert(portContacts.some(({ point }) => point[0] === -0.3004))
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "#ffffff",
  })
})
