import { test } from "bun:test"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("routed differential terminations stay electrically distinct", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential routedTermination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan: solver.getOutput().value[0],
    expectedTraceCount: 4,
    testPath: import.meta.path,
  })
})
