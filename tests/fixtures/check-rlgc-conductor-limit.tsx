/** @jsxRuntime automatic */
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { calculateCapacitanceMatrix } from "../../src/rlgc"
import { renderCoreSignals } from "../support/core-render"

const circuit = await renderCoreSignals(
  <board width={4} height={4}>
    <chip
      name="Conductor"
      pinLabels={{ pin1: "P" }}
      footprint={
        <footprint>
          <smtpad portHints={["pin1"]} width={0.4} height={0.4} shape="rect" />
        </footprint>
      }
    />
  </board>,
)
const [pad] = cju(circuit).pcb_smtpad.list()
assert.equal(pad.shape, "rect")
const conductorCount = 512
const conductors = Array.from({ length: conductorCount + 1 }, (_, index) => ({
  conductorId: `${pad.pcb_smtpad_id}-${index}`,
  xMm: pad.x,
  zMm: index + 0.25,
  widthMm: pad.width,
  thicknessMm: 0.035,
}))
const crossSection = {
  conductors,
  planes: Array.from({ length: conductors.length + 1 }, (_, zMm) => ({
    zMm,
  })),
  dielectricLayers: [],
}
assert.throws(() => calculateCapacitanceMatrix({ crossSection }), {
  code: "mesh_panel_limit",
  message: /conductor limit of 512/,
})
const matrix = calculateCapacitanceMatrix({
  crossSection: { ...crossSection, conductors: conductors.slice(0, -1) },
  options: { panelsPerEdge: 6 },
})
assert.equal(matrix.length, conductorCount)
assert.ok(Number.isFinite(matrix[0][0]) && matrix[0][0] > 0)
for (const [rowIndex, row] of matrix.entries()) {
  assert.equal(row.length, conductorCount)
  assert.ok(
    row.every((coefficient, columnIndex) =>
      columnIndex === rowIndex
        ? coefficient === matrix[0][0]
        : coefficient === 0,
    ),
  )
}
