import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteFieldsSolver } from "../../../src/extraction"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"
import { solveFieldsCopper } from "../../fixtures/fields-input"

test.failing(
  "preserves the physical clearance of nearly touching conductors",
  async () => {
    const circuit = await renderCopperGeometryBoard({
      children: (
        <>
          <CopperTrace name="First" width={0.3} />
          <CopperTrace
            name="Other"
            startY={0.30000004}
            width={0.3}
            net="net.OTHER"
          />
        </>
      ),
    })
    const copper = solveFieldsCopper(
      getCopperGeometryExtractionInput({ circuit }),
    )
    assert.equal(
      copper.geometry.sections[0].wires[1].lateralOffsetMm,
      0.30000004,
    )
    const solver = new RouteFieldsSolver({
      geometry: copper.geometry,
      artifactPrefix: "test",
    })
    solver.solve()
    assert.equal(solver.getOutput().value.slices[0].wires.length, 2)
  },
)
