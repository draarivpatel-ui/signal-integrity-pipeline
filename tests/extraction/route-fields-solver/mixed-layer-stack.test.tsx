import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildCrossSection } from "../../../src/extraction"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"
import { solveFieldsCopper } from "../../fixtures/fields-input"

test("uses the same board dielectric stack for a mixed-layer section and its inner pair", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Outer" />
        <CopperTrace
          name="Middle"
          startY={0.45}
          net="net.MIDDLE"
          points={[
            {
              x: -3,
              y: 0.45,
              via: true,
              fromLayer: "top",
              toLayer: "inner1",
            },
            { x: 0, y: 0.45 },
            { x: 3, y: 0.45, via: true, fromLayer: "inner1", toLayer: "top" },
          ]}
        />
        <CopperTrace
          name="Far"
          startY={0.9}
          net="net.FAR"
          points={[
            { x: -3, y: 0.9, via: true, fromLayer: "top", toLayer: "inner1" },
            { x: 0, y: 0.9 },
            { x: 3, y: 0.9, via: true, fromLayer: "inner1", toLayer: "top" },
          ]}
        />
      </>
    ),
  })
  const { geometry } = solveFieldsCopper(
    getCopperGeometryExtractionInput({ circuit }),
  )
  const wireSection = geometry.sections.find(
    ({ wires }) =>
      wires.filter(({ layer }) => layer === "inner1").length === 2 &&
      wires.some(({ layer }) => layer === "top"),
  )
  assert(wireSection)
  const materials = {
    maskThicknessMm: 0.02,
    maskRelativePermittivity: 3.3,
    maskLossTangent: 0.025,
    laminateLossTangent: 0.02,
  }
  const complete = buildCrossSection({
    geometry,
    wireSection,
    materials,
  })
  const inner = buildCrossSection({
    geometry,
    wireSection: {
      ...wireSection,
      wires: wireSection.wires.filter(({ layer }) => layer === "inner1"),
    },
    materials,
  })
  assert.deepEqual(inner.dielectricLayers, complete.dielectricLayers)
})
