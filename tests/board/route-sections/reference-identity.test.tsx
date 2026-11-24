import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { sectionRoutes } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionTrace,
} from "../../fixtures/route-section-board"

test("keeps separate copper pour identities on the same reference net", async () => {
  const circuit = await renderSectionBoard({
    children: (
      <>
        <SectionTrace name="Low" startY={-0.5} />
        <SectionTrace name="High" startY={0.5} net="net.OTHER" />
      </>
    ),
    reference: (
      <>
        <copperpour
          name="LowRef"
          connectsTo="net.GND"
          layer="bottom"
          unbroken
          outline={[
            { x: -5, y: -2 },
            { x: 5, y: -2 },
            { x: 5, y: -0.2 },
            { x: -5, y: -0.2 },
          ]}
        />
        <copperpour
          name="HighRef"
          connectsTo="net.GND"
          layer="bottom"
          unbroken
          outline={[
            { x: -5, y: 0.2 },
            { x: 5, y: 0.2 },
            { x: 5, y: 2 },
            { x: -5, y: 2 },
          ]}
        />
      </>
    ),
  })
  const db = cju(circuit)
  const pourIds = db.pcb_copper_pour
    .list()
    .map((pour) => pour.pcb_copper_pour_id)
    .sort()
  assert.equal(pourIds.length, 2)
  const { sections } = sectionRoutes({
    circuit,
    copperScope: getSectionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    sections.map(({ references }) => references[0].pcbCopperPourId).sort(),
    pourIds,
  )
})
