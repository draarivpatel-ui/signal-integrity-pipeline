import { test } from "bun:test"
import assert from "node:assert/strict"
import { edgeDurationSeconds } from "../../../src/buffers"
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
  const first = edgeDurationSeconds(inspectedPin({ board, text }))
  const second = edgeDurationSeconds(
    inspectedPin({ board, text: text.replace("1 DQ Fast", "1 DQ FAST") }),
  )
  assert.equal(second / first, 2)
})
