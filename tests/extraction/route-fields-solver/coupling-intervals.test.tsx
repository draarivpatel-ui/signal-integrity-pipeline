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
  "identifies the input section of each pair across a reference handoff",
  async () => {
    const circuit = await renderCopperGeometryBoard({
      children: (
        <>
          <CopperTrace name="First" />
          <CopperTrace name="Other" startY={0.5} net="net.OTHER" />
        </>
      ),
      reference: (
        <>
          <copperpour connectsTo="net.GND" layer="bottom" unbroken />
          <copperpour
            connectsTo="net.GND"
            layer="inner1"
            unbroken
            outline={[
              { x: 0, y: -2 },
              { x: 6, y: -2 },
              { x: 6, y: 2 },
              { x: 0, y: 2 },
            ]}
          />
        </>
      ),
    })
    const copper = solveFieldsCopper(
      getCopperGeometryExtractionInput({ circuit }),
    )
    const { sections } = copper.geometry
    assert.equal(sections.length, 2)
    assert.deepEqual(
      sections.map(({ references }) => references[0].layer),
      ["bottom", "inner1"],
    )
    const solver = new RouteFieldsSolver({
      geometry: copper.geometry,
      artifactPrefix: "test",
    })
    solver.solve()
    const output = solver.getOutput().value
    assert.deepEqual(
      output.coupling.map((pair) => Reflect.get(pair, "wireSectionIndex")),
      [0, 1],
    )
  },
)
