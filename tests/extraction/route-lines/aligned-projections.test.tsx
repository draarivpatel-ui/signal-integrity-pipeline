import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  channelCopperScope,
  extractCopperGeometry,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../../src/board"
import { rlgcCrossSection, routeCrossSection } from "../../../src/extraction"
import { calculateRlgc } from "../../../src/rlgc"
import { AlignedEdges } from "../../fixtures/aligned-edges"
import { renderCoreSignals } from "../../support/core-render"

test("coalesces aligned conductor projections", async () => {
  const circuit = await renderCoreSignals(<AlignedEdges />)
  const ground = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "GND")!
  const traces = circuit.filter((record) => record.type === "source_trace")
  const selected = new Set(
    traces.flatMap((trace) => trace.connected_source_port_ids),
  )
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const scope = channelCopperScope({
    circuit,
    connectivity,
    channelSourceIds: selected,
    referenceSourceIds: sourceNetMembers({
      connectivity,
      memberId: ground.source_net_id,
    }),
    railSourceIds: new Set(),
    distanceMm: 1,
  })
  const geometry = extractCopperGeometry({ circuit, copperScope: scope })
  const slice = geometry.sections.find(
    (slice) =>
      slice.wires.length === 2 &&
      slice.wires.every((wire) => wire.direction[1] === 1),
  )!
  assert.ok(slice)
  const materials = {
    maskMm: 0.02,
    maskEr: 3.3,
    maskLoss: 0.025,
    substrateLoss: 0.02,
  }
  const aligned = rlgcCrossSection(
    routeCrossSection({ geometry, slice, materials }),
  )
  const line = calculateRlgc({ crossSection: aligned })
  const mirrored = calculateRlgc({
    crossSection: {
      ...aligned,
      conductors: aligned.conductors.map((conductor) => ({
        ...conductor,
        xMm: -conductor.xMm,
      })),
    },
  })
  for (const kind of [
    "capacitanceFaradsPerMeter",
    "vacuumCapacitanceFaradsPerMeter",
    "externalInductanceHenriesPerMeter",
  ] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const relativeError = Math.abs(
          line[kind][i][j] / mirrored[kind][i][j] - 1,
        )
        assert.ok(relativeError < 1e-7, `${kind} respects physical reflection`)
      }
    }
  }
})
