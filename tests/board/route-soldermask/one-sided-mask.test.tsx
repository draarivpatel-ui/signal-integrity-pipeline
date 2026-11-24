import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { getSoldermaskThicknessMm } from "../../../src/board/route-soldermask"
import {
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("rejects an otherwise symmetric board with only one soldermask face", async () => {
  const circuit = await renderSectionBoard({
    children: <SectionTrace name="Masked" />,
  })
  const [stackup] = cju(circuit).pcb_stackup.list()
  assert(stackup)
  // Core's preset emits the copper and dielectric only. Declare one mask on that stackup.
  const layers = [
    { layer_type: "soldermask" as const, thickness: 0.02 },
    ...stackup.layers,
  ]
  assert.throws(() => getSoldermaskThicknessMm(layers), /Asymmetric soldermask/)
})
