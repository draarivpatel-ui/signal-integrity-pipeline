import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { RouteSectionsSolver } from "../../../src/board"
import {
  getSectionInput,
  renderSectionBoard,
  SectionPin,
  SectionTrace,
} from "../../fixtures/route-section-board"

test.failing(
  "uses the full barrel span on a board without blind vias",
  async () => {
    const circuit = await renderSectionBoard({
      allowBlindAndBuriedVias: false,
      children: (
        <>
          <SectionTrace name="Signal" startLayer="inner2" />
          <SectionPin name="Contact" x={0} />
          <via
            connectsTo="net.SIGNAL"
            pcbX={0}
            pcbY={0}
            fromLayer="top"
            toLayer="inner1"
            outerDiameter={0.6}
            holeDiameter={0.25}
          />
        </>
      ),
    })
    const [via] = cju(circuit).pcb_via.list()
    assert(via)
    assert(!via.layers.includes("inner2"))
    const solver = new RouteSectionsSolver(
      getSectionInput({ circuit, required: ["Contact"] }),
    )
    solver.solve()
    const { vias } = solver.getOutput().value.geometry
    assert(
      vias
        .find(({ pcbViaId }) => pcbViaId === via.pcb_via_id)
        ?.layers.includes("inner2"),
    )
  },
)
