import { test } from "bun:test"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import { AdmissionChannel } from "../../fixtures/admission-channel"
import { expectAdmissionPcbSnapshot } from "../../fixtures/admission-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("redundant named nets do not short routed series segments", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="series" namedNets />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  expectAdmissionPcbSnapshot({
    circuitJson,
    plan: solver.getOutput().value[0],
    expectedTraceCount: 2,
    testPath: import.meta.path,
  })
})
