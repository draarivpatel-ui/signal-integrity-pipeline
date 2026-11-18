import { test } from "bun:test"
import assert from "node:assert/strict"
import React from "react"
import {
  channelCopperScope,
  connectedSourceIds,
  segmentRoutes,
} from "../../src/board"
import { routeCrossSection, solveCrossSection } from "../../src/extraction"
import { renderCoreSignals } from "../support/core-render"
import { sectionFixture } from "./cross-section-fixtures"

/** Different-layer strip edges share a projection: 0.1/2 equals 0.2 - 0.3/2 physically. */
function AlignedEdges(): React.JSX.Element {
  return (
    <board
      width={8}
      height={12}
      layers={8}
      thickness={1.2}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      allowBlindAndBuriedVias
    >
      {["A", "B", "C", "D"].map((name, i) => (
        <chip
          key={name}
          name={name}
          pcbX={i < 2 ? -1 : 1}
          pcbY={i % 2 ? 4 : -4}
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
      {(["inner4", "inner5"] as const).map((layer, i) => (
        <React.Fragment key={layer}>
          <trace
            from={i ? ".C > .P" : ".A > .P"}
            to={i ? ".D > .P" : ".B > .P"}
            width={i ? 0.3 : 0.1}
            pcbPath={[
              i ? ".C > .P" : ".A > .P",
              { x: 0, y: 1 },
              { x: 0, y: 1, via: true, fromLayer: "top", toLayer: layer },
              { x: i ? -1 : 1.2, y: 2 },
              { x: i ? -1 : 1.2, y: 6 },
              { x: 0, y: 7 },
              { x: 0, y: 7, via: true, fromLayer: layer, toLayer: "top" },
              i ? ".D > .P" : ".B > .P",
            ]}
          />
        </React.Fragment>
      ))}
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="inner3" unbroken />
      <copperpour connectsTo="net.GND" layer="inner6" unbroken />
    </board>
  )
}

test("cross-section mesh preserves references, rejects invalid geometry and coalesces TSX aligned projections", async () => {
  const section = sectionFixture("mask", 2)
  const original = solveCrossSection(section)
  const reflected = solveCrossSection({
    conductors: section.conductors.map((c) => ({
      ...c,
      zMm: -c.zMm - c.thicknessMm,
    })),
    planes: section.planes,
    dielectrics: section.dielectrics.map((d) => ({
      ...d,
      zMm: -d.zMm - d.thicknessMm,
    })),
  })
  for (const key of ["C", "L"] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(original[key][i][j] / reflected[key][i][j] - 1) < 1e-8,
        )
      }
    }
  }
  const shielded = solveCrossSection({
    ...section,
    conductors: [
      section.conductors[0],
      { ...section.conductors[1], zMm: -1.035 },
    ],
    dielectrics: [],
  })
  for (const matrix of [
    shielded.C,
    shielded.C0,
    shielded.L,
    shielded.skinResistance,
    shielded.dielectricLoss,
  ]) {
    assert.equal(matrix[0][1], 0)
  }
  const permuted = solveCrossSection({
    ...section,
    conductors: [...section.conductors].reverse(),
  })
  for (const key of [
    "C",
    "C0",
    "L",
    "skinResistance",
    "dielectricLoss",
  ] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(original[key][i][j] / permuted[key][1 - i][1 - j] - 1) <
            1e-8,
        )
      }
    }
  }
  const close = solveCrossSection({
    conductors: [
      {
        id: "a",
        xMm: 0,
        zMm: 0.1,
        widthMm: 0.1,
        thicknessMm: 0.035,
      },
      {
        id: "b",
        xMm: 0.1002,
        zMm: 0.1,
        widthMm: 0.1,
        thicknessMm: 0.035,
      },
    ],
    planes: [{ zMm: 0 }],
    dielectrics: [],
  })
  assert.ok(close.diagnostics.recessionMm < 0.0002 / 4)

  assert.throws(() => solveCrossSection({ ...section, planes: [] }), {
    code: "native_geometry",
  })
  const flat = [{ ...section.conductors[0], thicknessMm: 0 }]
  assert.throws(() => solveCrossSection({ ...section, conductors: flat }), {
    code: "native_geometry",
  })
  const touchingPlane = [{ ...section.conductors[0], zMm: 0 }]
  assert.throws(
    () => solveCrossSection({ ...section, conductors: touchingPlane }),
    { code: "native_geometry" },
  )
  const duplicates = [section.conductors[0], section.conductors[0]]
  assert.throws(
    () => solveCrossSection({ ...section, conductors: duplicates }),
    { code: "native_geometry" },
  )
  const overlappingSlabs = [...section.dielectrics, section.dielectrics[0]]
  assert.throws(
    () => solveCrossSection({ ...section, dielectrics: overlappingSlabs }),
    { code: "native_geometry" },
  )
  assert.throws(() => solveCrossSection(section, { panelsPerEdge: 1 }), {
    code: "mesh_convergence",
  })
  const circuit = await renderCoreSignals(<AlignedEdges />)
  const ground = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "GND")!
  const selected = new Set(
    circuit
      .filter((record) => record.type === "source_trace")
      .flatMap((trace) => trace.connected_source_port_ids),
  )
  const geometry = segmentRoutes(
    circuit,
    channelCopperScope({
      circuit,
      selected,
      reference: connectedSourceIds(circuit, ground.source_net_id),
    }),
  )
  const slice = geometry.slices.find(
    (slice) =>
      slice.wires.length === 2 && slice.wires.every((wire) => wire.u[1] === 1),
  )!
  assert.ok(slice)
  const aligned = routeCrossSection({
    geometry,
    slice,
    materials: {
      maskMm: 0.02,
      maskEr: 3.3,
      maskLoss: 0.025,
      substrateLoss: 0.02,
    },
  })
  const line = solveCrossSection(aligned)
  const mirrored = solveCrossSection({
    ...aligned,
    conductors: aligned.conductors.map((conductor) => ({
      ...conductor,
      xMm: -conductor.xMm,
    })),
  })
  for (const kind of ["C", "C0", "L"] as const)
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++)
        assert.ok(
          Math.abs(line[kind][i][j] / mirrored[kind][i][j] - 1) < 1e-7,
          `${kind} respects physical reflection`,
        )
})
