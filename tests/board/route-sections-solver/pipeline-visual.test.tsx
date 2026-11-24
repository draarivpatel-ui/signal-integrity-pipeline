import { test } from "bun:test"
import type { RouteSectionsSolver } from "../../../src/board"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("two-trace TSX route-sections-solver visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertPlanDrawingSnapshot({
    drawing: root
      .getSolver<RouteSectionsSolver>("RouteSectionsSolver")!
      .visualize(),
    module: "board",
    name: "route-sections-solver",
  })
})
