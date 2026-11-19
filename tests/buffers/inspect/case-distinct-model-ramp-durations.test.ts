import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeSeconds } from "../../../src/buffers/inspect"
import {
  ibisInspectionBoard,
  inspectedPin,
  inspectionIbis,
  ramp,
} from "../../fixtures/ibis-inspection"

test("case-distinct model names keep their own ramp durations", async () => {
  const board = await ibisInspectionBoard()
  const modelData = `${ramp.replaceAll("600p", "300p")}
[Model] FAST
Model_type Output
C_comp 1p 1p 1p
[Voltage Range] 1.2 1.2 1.2
${ramp}`
  const text = inspectionIbis({ modelType: "Output", modelData })
  const first = edgeSeconds(inspectedPin({ board, text }))
  const second = edgeSeconds(
    inspectedPin({ board, text: text.replace("1 DQ Fast", "1 DQ FAST") }),
  )
  assert.equal(second / first, 2)
})
